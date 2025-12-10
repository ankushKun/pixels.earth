import { useCallback, useEffect, useMemo, useState, createContext, useContext, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import * as nacl from "tweetnacl";

/**
 * Session key state
 */
export interface SessionKeyState {
    /** The session keypair (available when session is active) */
    keypair: Keypair | null;
    /** Public key of the session key */
    publicKey: PublicKey | null;
    /** Whether a session is currently active */
    isActive: boolean;
    /** Timestamp when the session was created */
    createdAt: number | null;
    /** Optional expiry timestamp */
    expiresAt: number | null;
    /** The authorization signature from main wallet (for program verification) */
    authSignature: Uint8Array | null;
}

/**
 * Options for creating a session key
 */
export interface CreateSessionKeyOptions {
    /** Custom message to sign (defaults to a standard message with timestamp) */
    message?: string;
    /** Session duration in milliseconds (defaults to 24 hours) */
    duration?: number;
    /** Custom salt to make the session key unique per use case */
    salt?: string;
    /** 
     * Callback to create the on-chain session account after getting signatures.
     * Called with (sessionKeypair, mainWallet, authSignature, authMessage).
     * Should call initializeUser from useMagicplaceProgram.
     */
    onCreateAccount?: (
        sessionKeypair: import("@solana/web3.js").Keypair,
        mainWallet: import("@solana/web3.js").PublicKey,
        authSignature: Uint8Array,
        authMessage: string
    ) => Promise<string>;
    /**
     * Optional callback after key is derived but before authorization.
     * Return true to proceed with authorization, false to skip it (e.g. if already authorized).
     */
    onKeyDerived?: (keypair: import("@solana/web3.js").Keypair) => Promise<boolean>;
}

/**
 * Storage key prefix for persisting session keys
 */
const STORAGE_KEY_PREFIX = "magicplace_session_key_";

/**
 * Default session duration (24 hours in milliseconds)
 */
const DEFAULT_SESSION_DURATION = 24 * 60 * 60 * 1000;

/**
 * Generates the message for deriving the session keypair.
 * This is the first signature - used to deterministically create the session key.
 */
function generateDerivationMessage(walletPubkey: PublicKey): string {
    return `Create session key for Magicplace\nWallet: ${walletPubkey.toBase58()}`;
}

/**
 * Generates the authorization message for the program.
 * This is the second signature - proves the main wallet authorized this specific session key.
 * This message format MUST match what the Solana program expects.
 */
function generateAuthorizationMessage(sessionKeyPubkey: PublicKey, mainWalletPubkey: PublicKey): string {
    return `Authorize session key: ${sessionKeyPubkey.toBase58()} for wallet: ${mainWalletPubkey.toBase58()} on Magicplace`;
}

/**
 * Derives a Keypair from a signature using SHA-256 to create a 32-byte seed
 */
async function deriveKeypairFromSignature(signature: Uint8Array): Promise<Keypair> {
    // Hash the signature to get a 32-byte seed for Ed25519
    // Create a copy to ensure we have a proper ArrayBuffer (not SharedArrayBuffer)
    const signatureCopy = new Uint8Array(signature);
    const hashBuffer = await crypto.subtle.digest("SHA-256", signatureCopy);
    const seed = new Uint8Array(hashBuffer);
    
    // Use nacl to generate keypair from seed
    const naclKeypair = nacl.sign.keyPair.fromSeed(seed);
    
    // Convert to Solana Keypair (Solana expects 64-byte secret key: seed + public key)
    return Keypair.fromSecretKey(naclKeypair.secretKey);
}

// Context definition
interface SessionKeyContextType {
    sessionKey: SessionKeyState;
    publicKey: PublicKey | null;
    isActive: boolean;
    isExpired: boolean;
    timeRemaining: number | null;
    isLoading: boolean;
    error: string | null;
    createSessionKey: (options?: CreateSessionKeyOptions) => Promise<Keypair>;
    revokeSession: (salt?: string) => void;
    restoreSession: (salt?: string) => Promise<boolean>;
    signTransaction: <T extends Transaction | VersionedTransaction>(transaction: T) => Promise<T>;
    signAllTransactions: <T extends Transaction | VersionedTransaction>(transactions: T[]) => Promise<T[]>;
}

const SessionKeyContext = createContext<SessionKeyContextType | null>(null);

/**
 * Session Key Provider
 * MUST be wrapped inside WalletProvider
 */
export function SessionKeyProvider({ children }: { children: ReactNode }) {
    const wallet = useWallet();
    
    const [sessionState, setSessionState] = useState<SessionKeyState>({
        keypair: null,
        publicKey: null,
        isActive: false,
        createdAt: null,
        expiresAt: null,
        authSignature: null,
    });
    
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Get storage key for the current wallet
     */
    const getStorageKey = useCallback((salt: string = "default"): string => {
        if (!wallet.publicKey) return "";
        return `${STORAGE_KEY_PREFIX}${wallet.publicKey.toBase58()}_${salt}`;
    }, [wallet.publicKey]);

    /**
     * Try to restore session from localStorage
     */
    const restoreSession = useCallback(async (salt: string = "default"): Promise<boolean> => {
        if (!wallet.publicKey || !wallet.signMessage) {
            return false;
        }

        try {
            const storageKey = getStorageKey(salt);
            const stored = localStorage.getItem(storageKey);
            
            if (!stored) return false;
            
            const { derivationSignature, authSignature, createdAt, expiresAt, walletPubkey } = JSON.parse(stored);
            
            // Verify this session belongs to the current wallet
            if (walletPubkey !== wallet.publicKey.toBase58()) {
                localStorage.removeItem(storageKey);
                return false;
            }
            
            // Check expiry
            if (expiresAt && Date.now() > expiresAt) {
                localStorage.removeItem(storageKey);
                return false;
            }
            
            // Restore the keypair from the stored derivation signature
            const derivationSignatureBytes = new Uint8Array(Object.values(derivationSignature));
            const keypair = await deriveKeypairFromSignature(derivationSignatureBytes);
            
            // Restore the auth signature (may be null if steps were skipped)
            const authSignatureBytes = authSignature 
                ? new Uint8Array(Object.values(authSignature))
                : null;
            
            setSessionState({
                keypair,
                publicKey: keypair.publicKey,
                isActive: true,
                createdAt,
                expiresAt,
                authSignature: authSignatureBytes,
            });
            
            return true;
        } catch (err) {
            console.debug("Failed to restore session:", err);
            return false;
        }
    }, [wallet.publicKey, wallet.signMessage, getStorageKey]);

    /**
     * Create a new session key by requesting a signature from the wallet
     */
    const createSessionKey = useCallback(async (options: CreateSessionKeyOptions = {}): Promise<Keypair> => {
        if (!wallet.publicKey || !wallet.signMessage) {
            throw new Error("Wallet not connected or does not support message signing");
        }

        const {
            message,
            duration = DEFAULT_SESSION_DURATION,
            salt = "default",
            onCreateAccount,
            onKeyDerived,
        } = options;

        setIsLoading(true);
        setError(null);

        try {
            // SIGNATURE 1: Derive the session keypair
            // This message is used to deterministically generate the session key
            const derivationMessage = message || generateDerivationMessage(wallet.publicKey);
            const derivationMessageBytes = new TextEncoder().encode(derivationMessage);
            
            // Request first signature from wallet (popup 1)
            const derivationSignature = await wallet.signMessage(derivationMessageBytes);
            
            // Derive keypair from the first signature
            const keypair = await deriveKeypairFromSignature(derivationSignature);

            let authSignature: Uint8Array | null = null;
            let proceed = true;

            // Check if we should proceed with authorization
            if (onKeyDerived) {
                proceed = await onKeyDerived(keypair);
            }

            if (proceed) {
                // SIGNATURE 2: Authorize this specific session key
                // This proves the main wallet authorized THIS session key (not just any key)
                const authMessage = generateAuthorizationMessage(keypair.publicKey, wallet.publicKey);
                const authMessageBytes = new TextEncoder().encode(authMessage);
                
                // Request second signature from wallet (popup 2)
                authSignature = await wallet.signMessage(authMessageBytes);
                
                // STEP 3: Create on-chain session account (if callback provided)
                if (onCreateAccount) {
                    await onCreateAccount(keypair, wallet.publicKey, authSignature, authMessage);
                }
            }
            
            const now = Date.now();
            const expiresAt = duration > 0 ? now + duration : null;
            
            // Store session info (including both signatures)
            const storageKey = getStorageKey(salt);
            localStorage.setItem(storageKey, JSON.stringify({
                derivationSignature: Array.from(derivationSignature),
                authSignature: authSignature ? Array.from(authSignature) : null,
                createdAt: now,
                expiresAt,
                walletPubkey: wallet.publicKey.toBase58(),
                sessionPubkey: keypair.publicKey.toBase58(),
            }));
            
            // Update state
            setSessionState({
                keypair,
                publicKey: keypair.publicKey,
                isActive: true,
                createdAt: now,
                expiresAt,
                authSignature: authSignature,
            });
            
            return keypair;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to create session key";
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [wallet.publicKey, wallet.signMessage, getStorageKey]);

    /**
     * Revoke the current session and clear stored data
     */
    const revokeSession = useCallback((salt: string = "default") => {
        const storageKey = getStorageKey(salt);
        localStorage.removeItem(storageKey);
        
        setSessionState({
            keypair: null,
            publicKey: null,
            isActive: false,
            createdAt: null,
            expiresAt: null,
            authSignature: null,
        });
        
        setError(null);
    }, [getStorageKey]);

    /**
     * Sign a transaction using the session key
     */
    const signTransaction = useCallback(async <T extends Transaction | VersionedTransaction>(
        transaction: T
    ): Promise<T> => {
        if (!sessionState.keypair) {
            throw new Error("No active session key");
        }

        // Check expiry
        if (sessionState.expiresAt && Date.now() > sessionState.expiresAt) {
            setSessionState(prev => ({ ...prev, isActive: false }));
            throw new Error("Session key has expired");
        }

        if (transaction instanceof Transaction) {
            transaction.partialSign(sessionState.keypair);
        } else {
            // For VersionedTransaction
            transaction.sign([sessionState.keypair]);
        }

        return transaction;
    }, [sessionState.keypair, sessionState.expiresAt]);

    /**
     * Sign multiple transactions using the session key
     */
    const signAllTransactions = useCallback(async <T extends Transaction | VersionedTransaction>(
        transactions: T[]
    ): Promise<T[]> => {
        if (!sessionState.keypair) {
            throw new Error("No active session key");
        }

        // Check expiry
        if (sessionState.expiresAt && Date.now() > sessionState.expiresAt) {
            setSessionState(prev => ({ ...prev, isActive: false }));
            throw new Error("Session key has expired");
        }

        return transactions.map(tx => {
            if (tx instanceof Transaction) {
                tx.partialSign(sessionState.keypair!);
            } else {
                tx.sign([sessionState.keypair!]);
            }
            return tx;
        });
    }, [sessionState.keypair, sessionState.expiresAt]);

    /**
     * Check if the session is expired
     */
    const isExpired = useMemo(() => {
        if (!sessionState.expiresAt) return false;
        return Date.now() > sessionState.expiresAt;
    }, [sessionState.expiresAt]);

    /**
     * Time remaining in the session (in milliseconds)
     */
    const timeRemaining = useMemo(() => {
        if (!sessionState.expiresAt) return null;
        const remaining = sessionState.expiresAt - Date.now();
        return remaining > 0 ? remaining : 0;
    }, [sessionState.expiresAt]);

    /**
     * Auto-restore session on wallet connection
     */
    useEffect(() => {
        if (wallet.publicKey && !sessionState.isActive) {
            restoreSession();
        }
    }, [wallet.publicKey, restoreSession, sessionState.isActive]);

    /**
     * Clear session on wallet disconnect
     */
    useEffect(() => {
        if (!wallet.publicKey && sessionState.isActive) {
            setSessionState({
                keypair: null,
                publicKey: null,
                isActive: false,
                createdAt: null,
                expiresAt: null,
                authSignature: null,
            });
        }
    }, [wallet.publicKey, sessionState.isActive]);

    /**
     * Set up expiry check interval
     */
    useEffect(() => {
        if (!sessionState.expiresAt || !sessionState.isActive) return;

        const checkExpiry = () => {
            if (Date.now() > sessionState.expiresAt!) {
                setSessionState(prev => ({ ...prev, isActive: false }));
            }
        };

        const interval = setInterval(checkExpiry, 1000);
        return () => clearInterval(interval);
    }, [sessionState.expiresAt, sessionState.isActive]);

    const value = useMemo(() => ({
        sessionKey: sessionState,
        publicKey: sessionState.publicKey,
        isActive: sessionState.isActive,
        isExpired,
        timeRemaining,
        isLoading,
        error,
        createSessionKey,
        revokeSession,
        restoreSession,
        signTransaction,
        signAllTransactions,
    }), [
        sessionState,
        isExpired,
        timeRemaining,
        isLoading,
        error,
        createSessionKey,
        revokeSession,
        restoreSession,
        signTransaction,
        signAllTransactions
    ]);

    return (
        <SessionKeyContext.Provider value={value}>
            {children}
        </SessionKeyContext.Provider>
    );
}

/**
 * Hook for managing deterministic session keys derived from wallet signatures.
 */
export function useSessionKey() {
    const context = useContext(SessionKeyContext);
    if (!context) {
        throw new Error("useSessionKey must be used within a SessionKeyProvider");
    }
    return context;
}

/**
 * Type export for session key manager return type
 */
export type UseSessionKeyReturn = SessionKeyContextType;
