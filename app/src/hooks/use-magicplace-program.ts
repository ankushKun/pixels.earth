import { useCallback, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Program, AnchorProvider, setProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import { type Magicplace } from "../idl/magicplace";
import IDL from "../idl/magicplace.json";
import { SHARD_DIMENSION, SHARDS_PER_DIM } from "../constants";
import { useSessionKey } from "./use-session-key";
import { useRpcSettings, getWsEndpoint } from "./use-rpc-settings";
import { BN } from "@coral-xyz/anchor"; // Ensure BN is available

// Note: @magicblock-labs/ephemeral-rollups-sdk is imported dynamically to avoid
// Buffer not defined errors during module initialization

// Shard account data structure matching the Rust contract
export interface PixelShardAccount {
    shardX: number;
    shardY: number;
    pixels: Uint8Array;
    creator: PublicKey;
    bump: number;
}

export interface SessionAccount {
    mainAddress: PublicKey;
    authority: PublicKey;
    cooldownCounter: number;
    lastPlaceTimestamp: BN;
    bump: number;
}

// Cooldown Constants
export const COOLDOWN_LIMIT = 50;
export const COOLDOWN_PERIOD = 30; // seconds

// Priority fee for base layer transactions (MicroLamports)
const PRIORITY_FEE_MICRO_LAMPORTS = 200_000;

// Delegation status
export type DelegationStatus = "undelegated" | "delegated" | "not-initialized" | "checking";

// Seed prefix for shard PDAs (must match contract: b"shard")
const SHARD_SEED = Buffer.from("shard");

// Seed prefix for session account PDAs (must match contract: b"session")
const SESSION_SEED = Buffer.from("session");

// Delegation Program ID
const DELEGATION_PROGRAM_ID = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

// Cost estimation constants (in SOL)
// Shard account: 8 + 2 + 2 + 8192 + 32 + 1 = 8237 bytes  
// Rent-exempt minimum for ~8.3KB = ~0.058 SOL (at 6.96 lamports/byte)
export const SHARD_RENT_SOL = 0.06;  // Slightly rounded up for safety
export const TX_FEE_SOL = 0.0005;    // ~5000 lamports per transaction with priority fee
export const DELEGATION_TX_FEE_SOL = 0.001; // Delegation CPI is more expensive

/**
 * Derive the PDA for a shard at (shardX, shardY)
 */
export function deriveShardPDA(shardX: number, shardY: number): PublicKey {
    const shardXBytes = Buffer.alloc(2);
    shardXBytes.writeUInt16LE(shardX);
    const shardYBytes = Buffer.alloc(2);
    shardYBytes.writeUInt16LE(shardY);

    const [pda] = PublicKey.findProgramAddressSync(
        [SHARD_SEED, shardXBytes, shardYBytes],
        new PublicKey(IDL.address)
    );
    return pda;
}

/**
 * Calculate which shard contains a given global pixel coordinate
 */
export function getShardForPixel(px: number, py: number): { shardX: number; shardY: number } {
    return {
        shardX: Math.floor(px / SHARD_DIMENSION),
        shardY: Math.floor(py / SHARD_DIMENSION),
    };
}

/**
 * Derive the PDA for a session account based on the session key (authority)
 */
export function deriveSessionPDA(sessionKey: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [SESSION_SEED, sessionKey.toBuffer()],
        new PublicKey(IDL.address)
    );
    return pda;
}

/**
 * Hook to interact with the Magicplace program on Solana.
 * Provides functions to manage shards and pixels.
 * Supports MagicBlock Ephemeral Rollups for delegation and commit.
 */
export function useMagicplaceProgram() {
    const { connection } = useConnection();
    const wallet = useWallet();
    const { sessionKey, isActive: sessionActive } = useSessionKey();
    const { magicblockRpc } = useRpcSettings();

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Base layer Anchor provider and program (uses main wallet - for setup only)
    const program = useMemo(() => {
        if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
            return null;
        }

        const provider = new AnchorProvider(
            connection,
            {
                publicKey: wallet.publicKey,
                signTransaction: wallet.signTransaction,
                signAllTransactions: wallet.signAllTransactions,
            },
            { commitment: "confirmed" }
        );

        setProvider(provider);

        return new Program<Magicplace>(IDL as Magicplace, provider);

    }, [connection, wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions]);

    // Read-only Base Layer provider (for fetching without wallet)
    const readOnlyProvider = useMemo(() => {
        const dummyWallet = {
            publicKey: PublicKey.default,
            signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => tx,
            signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs,
        };
        
        return new AnchorProvider(
            connection,
            dummyWallet,
            { commitment: "confirmed" }
        );
    }, [connection]);

    const readOnlyProgram = useMemo(() => {
        return new Program<Magicplace>(IDL as Magicplace, readOnlyProvider);
    }, [readOnlyProvider]);

    // Session-based program for base layer (uses session keypair for signing)
    const sessionProgram = useMemo(() => {
        if (!sessionKey.keypair) {
            return null;
        }

        const keypair = sessionKey.keypair;
        const provider = new AnchorProvider(
            connection,
            {
                publicKey: keypair.publicKey,
                signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
                    if (tx instanceof Transaction) {
                        tx.partialSign(keypair);
                    }
                    // VersionedTransaction would need different handling, but Anchor uses Transaction
                    return tx;
                },
                signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
                    txs.forEach(tx => {
                        if (tx instanceof Transaction) {
                            tx.partialSign(keypair);
                        }
                    });
                    return txs;
                },
            },
            { commitment: "confirmed" }
        );

        return new Program<Magicplace>(IDL as Magicplace, provider);
    }, [connection, sessionKey.keypair]);

    // Ephemeral Rollup connection
    const erConnection = useMemo(() => {
        return new Connection(magicblockRpc, {
            wsEndpoint: getWsEndpoint(magicblockRpc),
            commitment: "confirmed",
        });
    }, [magicblockRpc]);

    // ER provider using main wallet (for setup only)
    const erProvider = useMemo(() => {
        if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
            return null;
        }

        return new AnchorProvider(
            erConnection,
            {
                publicKey: wallet.publicKey,
                signTransaction: wallet.signTransaction,
                signAllTransactions: wallet.signAllTransactions,
            },
            { commitment: "confirmed" }
        );
    }, [erConnection, wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions]);

    // Session-based ER provider (uses session keypair for signing)
    const sessionErProvider = useMemo(() => {
        if (!sessionKey.keypair) {
            return null;
        }

        const keypair = sessionKey.keypair;
        return new AnchorProvider(
            erConnection,
            {
                publicKey: keypair.publicKey,
                signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
                    if (tx instanceof Transaction) {
                        tx.partialSign(keypair);
                    }
                    return tx;
                },
                signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
                    txs.forEach(tx => {
                        if (tx instanceof Transaction) {
                            tx.partialSign(keypair);
                        }
                    });
                    return txs;
                },
            },
            { commitment: "confirmed" }
        );
    }, [erConnection, sessionKey.keypair]);

    const erProgram = useMemo(() => {
        if (!erProvider) {
            return null;
        }

        return new Program<Magicplace>(IDL as Magicplace, erProvider);
    }, [erProvider]);

    const sessionErProgram = useMemo(() => {
        if (!sessionErProvider) {
            return null;
        }

        return new Program<Magicplace>(IDL as Magicplace, sessionErProvider);
    }, [sessionErProvider]);

    // Read-only ER provider (for fetching without wallet)
    const readOnlyErProvider = useMemo(() => {
        const dummyWallet = {
            publicKey: PublicKey.default,
            signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => tx,
            signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs,
        };
        
        return new AnchorProvider(
            erConnection,
            dummyWallet,
            { commitment: "confirmed" }
        );
    }, [erConnection]);

    const readOnlyErProgram = useMemo(() => {
        return new Program<Magicplace>(IDL as Magicplace, readOnlyErProvider);
    }, [readOnlyErProvider]);

    // ========================================
    // Session State
    // ========================================

    const fetchSessionAccount = useCallback(async (sessionKeyPubkey: PublicKey): Promise<SessionAccount | null> => {
       if (!program && !readOnlyErProgram) return null;
       
       const sessionPDA = deriveSessionPDA(sessionKeyPubkey);
       
       // Try ER first (fast path)
       if (erProgram || readOnlyErProgram) {
           try {
               const target = erProgram || readOnlyErProgram;
               const account = await target!.account.sessionAccount.fetch(sessionPDA);
               return account as SessionAccount;
           } catch (e) {
               // Not on ER
           }
       }
       
       // Try Base Layer
       if (program) {
            try {
                const account = await program.account.sessionAccount.fetch(sessionPDA);
                return account as SessionAccount;
            } catch (e) {
                return null;
            }
       }

       return null;
    }, [program, erProgram, readOnlyErProgram]);

    /**
     * Check if user can place a pixel on a specific shard based on cooldown rules.
     * Returns { allowed: boolean, reason?: string, remaining?: number, refreshIn?: number }
     */
    const checkCanPlacePixel = useCallback(async (shardCreator: PublicKey, mainWallet: PublicKey): Promise<{ allowed: boolean, reason?: string, remaining?: number, refreshIn?: number }> => {
        // 1. If user owns the shard, no cooldown
        if (shardCreator.equals(mainWallet)) {
            return { allowed: true };
        }

        // 2. Fetch session account to check limits
        // We need the active session key
        if (!sessionKey.keypair) {
             // If no session key, maybe we are using main wallet directly?
             // But if using main wallet directly, our "session key" IS the main wallet (signer).
             // Let's assume passed signer is what initiates the action.
             // But here we don't have the signer passed as arg.
             // Assume we use the active session key from valid hook if exists, else main wallet?
             // But wait, the hook uses `sessionKey.keypair` if active.
             return { allowed: true, remaining: COOLDOWN_LIMIT }; // Fallback
        }

        const session = await fetchSessionAccount(sessionKey.keypair.publicKey);
        if (!session) {
            // No session account means fresh state (all zeros), allowed to start
            return { allowed: true, remaining: COOLDOWN_LIMIT };
        }

        const now = Math.floor(Date.now() / 1000);
        const lastPlace = session.lastPlaceTimestamp.toNumber();
        const timeDiff = now - lastPlace;

        // Logic from contract:
        // if now.saturating_sub(session.last_place_timestamp) >= COOLDOWN_PERIOD {
        //      session.cooldown_counter = 0;
        // }
        let currentCounter = session.cooldownCounter;
        if (timeDiff >= COOLDOWN_PERIOD) {
            currentCounter = 0;
        }

        // if session.cooldown_counter >= COOLDOWN_LIMIT { return err!(PixelError::Cooldown); }
        if (currentCounter >= COOLDOWN_LIMIT) {
             const waitTime = COOLDOWN_PERIOD - timeDiff; // This might be weird if timeDiff > COOLDOWN_PERIOD, but in that case counter is 0.
             // Wait, if counter >= LIMIT, it means timeDiff < COOLDOWN_PERIOD necessarily (unless logic error).
             // Actually, if timeDiff >= COOLDOWN_PERIOD, counter resets to 0, so it won't be >= LIMIT.
             // So here timeDiff < COOLDOWN_PERIOD.
             return { 
                 allowed: false, 
                 reason: `Cooldown active. limit reached.`, 
                 refreshIn: Math.max(0, COOLDOWN_PERIOD - timeDiff) 
             };
        }

        return { 
            allowed: true, 
            remaining: COOLDOWN_LIMIT - currentCounter 
        };

    }, [fetchSessionAccount]);

    // ========================================
    // Shard Query Functions
    // ========================================

    /**
     * Fetch a shard account by coordinates
     */
    const fetchShard = useCallback(async (shardX: number, shardY: number): Promise<PixelShardAccount | null> => {
        if (!program) return null;

        try {
            const shardPDA = deriveShardPDA(shardX, shardY);
            const account = await program.account.pixelShard.fetch(shardPDA);
            return {
                shardX: account.shardX,
                shardY: account.shardY,
                pixels: new Uint8Array(account.pixels),
                creator: account.creator,
                bump: account.bump,
            };
        } catch (err) {
            // Shard not initialized yet - this is normal
            console.debug(`Shard (${shardX}, ${shardY}) not found`);
            return null;
        }
    }, [program]);

    /**
     * Check shard availability and delegation status.
     * Checks in order:
     * 1. MagicBlock ER endpoint - if found, shard is delegated and ready for fast transactions
     * 2. Base Solana layer - if found, shard exists but needs delegation
     * 3. Not found anywhere - shard needs to be initialized
     * 
     * Returns: "delegated" | "undelegated" | "not-initialized"
     */
    const checkShardDelegation = useCallback(async (shardX: number, shardY: number): Promise<DelegationStatus> => {
        const shardPDA = deriveShardPDA(shardX, shardY);
        
        try {
            // Step 1: Check MagicBlock ER endpoint first (fastest path for active shards)
            try {
                const erAccountInfo = await erConnection.getAccountInfo(shardPDA);
                if (erAccountInfo && erAccountInfo.data.length > 0) {
                    // console.debug(`Shard (${shardX}, ${shardY}) found on ER - delegated`);
                    return "delegated";
                }
            } catch (erErr) {
                // ER might be unavailable or account not found, continue to base layer check
                // console.debug(`ER check failed for shard (${shardX}, ${shardY}), checking base layer...`);
            }

            // Step 2: Check base Solana layer
            // Force "confirmed" commitment to ensure we see latest state
            const baseAccountInfo = await connection.getAccountInfo(shardPDA, "confirmed");
            
            if (!baseAccountInfo) {
                // console.log(`Shard (${shardX}, ${shardY}) not found on base layer - needs initialization`);
                return "not-initialized";
            }

            // Account exists on base layer
            // Check if it's currently delegated (owned by delegation program)
            // Use strict string comparison for safety
            const ownerStr = baseAccountInfo.owner.toBase58();
            const delegationProgramStr = DELEGATION_PROGRAM_ID.toBase58();
            const isDelegatedOwner = ownerStr === delegationProgramStr;
            
            console.log(`Debug checkShardDelegation (${shardX}, ${shardY}):`, {
                exists: true,
                owner: ownerStr,
                expectedOwner: delegationProgramStr,
                match: isDelegatedOwner
            });

            if (isDelegatedOwner) {
                console.log(`Shard (${shardX}, ${shardY}) is delegated (base layer check)`);
                return "delegated";
            }

            // Account exists but is not delegated
            console.log(`Shard (${shardX}, ${shardY}) exists but not delegated. Owner: ${ownerStr}`);
            return "undelegated";
        } catch (err) {
            console.error("Error checking shard status:", err);
            // Default to not-initialized to allow retry
            return "not-initialized";
        }
    }, [connection, erConnection]);

    /**
     * Fetch a shard from Ephemeral Rollups (when delegated)
     */
    const fetchShardFromER = useCallback(async (shardX: number, shardY: number): Promise<PixelShardAccount | null> => {
        const targetProgram = erProgram || readOnlyErProgram;
        if (!targetProgram) return null;

        try {
            const shardPDA = deriveShardPDA(shardX, shardY);
            const account = await targetProgram.account.pixelShard.fetch(shardPDA);
            return {
                shardX: account.shardX,
                shardY: account.shardY,
                pixels: new Uint8Array(account.pixels),
                creator: account.creator,
                bump: account.bump,
            };
        } catch (err) {
            // console.debug(`Shard (${shardX}, ${shardY}) not found on ER`);
            return null;
        }
    }, [erProgram, readOnlyErProgram]);

    /**
     * Fetch all delegated shards from Ephemeral Rollups
     * This returns all shards that exist on the ER
     */
    const getAllDelegatedShards = useCallback(async (): Promise<PixelShardAccount[]> => {
        console.log("[getAllDelegatedShards] Starting fetch...");
        const targetProgram = erProgram || readOnlyErProgram;
        if (!targetProgram) {
            console.log("[getAllDelegatedShards] No ER program available");
            return [];
        }

        try {
            console.log(`[getAllDelegatedShards] Program ID: ${targetProgram.programId.toBase58()}`);
            const accounts = await targetProgram.account.pixelShard.all();
            console.log(`[getAllDelegatedShards] Found ${accounts.length} shards`);
            
            if (accounts.length > 0) {
                accounts.forEach((a, i) => {
                    console.log(`[getAllDelegatedShards] Shard ${i}: (${a.account.shardX}, ${a.account.shardY}) - ${a.account.pixels.length} bytes`);
                });
            }
            
            return accounts.map(a => ({
                shardX: a.account.shardX,
                shardY: a.account.shardY,
                pixels: new Uint8Array(a.account.pixels),
                creator: a.account.creator,
                bump: a.account.bump,
            }));
        } catch (err) {
            console.error("[getAllDelegatedShards] ERROR:", err);
            return [];
        }
    }, [erProgram, readOnlyErProgram]);

    // ========================================
    // Shard Management Functions
    // ========================================



    /**
     * Initialize a user session account on-chain.
     * Called by the session keypair, passing the auth signature from the main wallet.
     * 
     * @param sessionKeypair - The session keypair (derived from first signature)
     * @param mainWallet - The main wallet public key
     * @param authSignature - The authorization signature from main wallet (second signature)
     * @param authMessage - The message that was signed (for Ed25519 verification)
     */
    const initializeUser = useCallback(async (
        sessionKeypair: Keypair,
        mainWallet: PublicKey,
        authSignature: Uint8Array,
        authMessage?: string
    ): Promise<string> => {
        if (!program) {
            throw new Error("Program not initialized");
        }

        setIsLoading(true);
        setError(null);

        try {
            // Import Ed25519Program for signature verification
            const { Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY } = await import("@solana/web3.js");
            
            // Generate the authorization message if not provided
            const message = authMessage || `Authorize session key: ${sessionKeypair.publicKey.toBase58()} for wallet: ${mainWallet.toBase58()} on Magicplace`;
            const messageBytes = new TextEncoder().encode(message);
            
            // Create Ed25519 signature verification instruction
            // This MUST be the first instruction in the transaction
            const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
                publicKey: mainWallet.toBytes(),
                message: messageBytes,
                signature: authSignature,
            });
            
            // Build the program instruction
            const programIx = await program.methods
                .initializeUser(mainWallet, Array.from(authSignature) as number[])
                .accounts({
                    authority: sessionKeypair.publicKey,
                    // @ts-ignore
                    instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
                })
                .instruction();
                
            // Add priority fee
            const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: PRIORITY_FEE_MICRO_LAMPORTS,
            });
            
            // Create transaction with Ed25519 verify as first instruction
            // Priority fee is added last to keep Ed25519 at index 0 
            const tx = new Transaction().add(ed25519Ix, programIx, priorityFeeIx);
            
            // Set up transaction
            tx.feePayer = sessionKeypair.publicKey;
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
            tx.recentBlockhash = blockhash;

            // Sign with session keypair
            tx.sign(sessionKeypair);

            // Send transaction
            const signature = await connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: true, // Required for Ed25519 instruction
            });
            await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

            return signature;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to initialize user";
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [program, connection]);

    /**
     * Delegate a user session account to Ephemeral Rollups.
     * This should be called after initializeUser in a separate transaction.
     * 
     * @param sessionKeypair - The session keypair
     * @param mainWallet - The main wallet public key
     */
    const delegateUser = useCallback(async (
        sessionKeypair: Keypair,
        mainWallet: PublicKey
    ): Promise<string> => {
        if (!program) {
            throw new Error("Program not initialized");
        }

        setIsLoading(true);
        setError(null);

        try {
            // Priority fee instruction
            const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: PRIORITY_FEE_MICRO_LAMPORTS,
            });

            // Build the delegation transaction
            // Note: delegateUser(mainWallet) still takes mainWallet arg, but PDA is derived from signer
            const tx = await program.methods
                .delegateUser(mainWallet) 
                .accounts({
                    authority: sessionKeypair.publicKey,
                    // user is auto-derived from authority
                })
                .preInstructions([priorityFeeIx])
                .transaction();

            // Set up transaction
            tx.feePayer = sessionKeypair.publicKey;
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
            tx.recentBlockhash = blockhash;

            // Sign with session keypair
            tx.sign(sessionKeypair);

            // Send transaction
            const signature = await connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: true, // Required for delegation CPI
            });
            await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

            return signature;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to delegate user";
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [program, connection]);

    /**
     * Check if a user session account is delegated to Ephemeral Rollups
     */
    const checkUserDelegation = useCallback(async (sessionKeyPubkey: PublicKey): Promise<DelegationStatus> => {
        const sessionPDA = deriveSessionPDA(sessionKeyPubkey);
        
        try {
            const accountInfo = await connection.getAccountInfo(sessionPDA);
            
            if (!accountInfo) {
                // If account doesn't exist, it's not delegated (or not initialized which is fine here)
                 return "not-initialized"; 
            }

            // Check if the account owner is the delegation program
            return accountInfo.owner.equals(DELEGATION_PROGRAM_ID) ? "delegated" : "undelegated";
        } catch (err) {
            return "undelegated";
        }
    }, [connection]);

    // ========================================
    // Pixel Placement Functions
    // ========================================

    /**
     * Place a pixel at global coordinates (px, py) with color (1-15)
     * The shard coordinates are calculated automatically
     */
    const placePixel = useCallback(async (px: number, py: number, color: number): Promise<string> => {
        if (!program || !wallet.publicKey) {
            throw new Error("Wallet not connected");
        }

        if (color < 1 || color > 255) {
            throw new Error(`Invalid color: ${color}. Must be 1-255`);
        }

        const { shardX, shardY } = getShardForPixel(px, py);

        setIsLoading(true);
        setError(null);

        try {
            // For "send from wallet", the wallet.publicKey IS the signer (authority)
            // So the session account is derived from wallet.publicKey
            const tx = await program.methods
                .placePixel(shardX, shardY, px, py, color)
                .accounts({
                    signer: wallet.publicKey,
                    // session PDA auto-derived from signer
                })
                .rpc();

            return tx;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to place pixel";
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [program, wallet.publicKey]);

    /**
     * Erase a pixel at global coordinates (px, py) - sets it to 0/transparent
     */
    const erasePixel = useCallback(async (px: number, py: number): Promise<string> => {
        if (!program || !wallet.publicKey) {
            throw new Error("Wallet not connected");
        }

        const { shardX, shardY } = getShardForPixel(px, py);

        setIsLoading(true);
        setError(null);

        try {
            const tx = await program.methods
                .erasePixel(shardX, shardY, px, py)
                .accounts({
                    signer: wallet.publicKey,
                    // session PDA auto-derived from signer
                })
                .rpc();

            return tx;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to erase pixel";
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [program, wallet.publicKey]);

    // ========================================
    // Ephemeral Rollups Pixel Functions
    // ========================================

    /**
     * Place a pixel on Ephemeral Rollups (when shard is delegated)
     * Uses session key for signing - no wallet popup needed
     */
    const placePixelOnER = useCallback(async (px: number, py: number, color: number): Promise<string> => {
        console.log(`[placePixelOnER] Starting: px=${px}, py=${py}, color=${color}`);
        
        if (!sessionProgram || !sessionKey.keypair) {
            console.error("[placePixelOnER] Session program or key not available");
            throw new Error("Session program or key not available");
        }

        if (color < 1 || color > 255) {
            console.error(`[placePixelOnER] Invalid color: ${color}`);
            throw new Error(`Invalid color: ${color}. Must be 1-255`);
        }

        const { shardX, shardY } = getShardForPixel(px, py);
        console.log(`[placePixelOnER] Shard: (${shardX}, ${shardY})`);

        setIsLoading(true);
        setError(null);

        try {
            console.log("[placePixelOnER] Building instruction...");
            const placeIx = await sessionProgram.methods
                .placePixel(shardX, shardY, px, py, color)
                .accounts({
                    signer: sessionKey.keypair.publicKey,
                })
                .instruction();
            console.log("[placePixelOnER] Instruction built successfully");

            const tx = new Transaction().add(placeIx);
            tx.feePayer = sessionKey.keypair.publicKey;
            
            console.log("[placePixelOnER] Getting latest blockhash...");
            const { blockhash, lastValidBlockHeight } = await erConnection.getLatestBlockhash();
            tx.recentBlockhash = blockhash;
            console.log(`[placePixelOnER] Blockhash: ${blockhash}`);
            
            tx.sign(sessionKey.keypair);
            console.log("[placePixelOnER] Transaction signed");

            console.log("[placePixelOnER] Sending transaction...");
            const txHash = await erConnection.sendRawTransaction(tx.serialize(), {
                skipPreflight: true,
            });
            console.log(`[placePixelOnER] Transaction sent: ${txHash}`);

            console.log("[placePixelOnER] Waiting for confirmation...");
            const confirmation = await erConnection.confirmTransaction(
                { signature: txHash, blockhash, lastValidBlockHeight },
                "confirmed"
            );
            
            if (confirmation.value.err) {
                console.error("[placePixelOnER] Transaction FAILED on-chain:", confirmation.value.err);
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }
            
            console.log(`[placePixelOnER] SUCCESS: ${txHash}`);
            return txHash;
        } catch (err) {
            console.error("[placePixelOnER] ERROR:", err);
            const message = err instanceof Error ? err.message : "Failed to place pixel on ER";
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [sessionProgram, sessionKey.keypair, erConnection]);

    /**
     * Erase a pixel on Ephemeral Rollups (when shard is delegated)
     * Uses session key for signing - no wallet popup needed
     */
    const erasePixelOnER = useCallback(async (px: number, py: number): Promise<string> => {
        if (!sessionProgram || !sessionKey.keypair) {
            throw new Error("Session program or key not available");
        }

        const { shardX, shardY } = getShardForPixel(px, py);

        setIsLoading(true);
        setError(null);

        try {
            // Build instruction using session program for IDL
            const eraseIx = await sessionProgram.methods
                .erasePixel(shardX, shardY, px, py)
                .accounts({
                    signer: sessionKey.keypair.publicKey,
                    // session -> auto-derived from signer
                })
                .instruction();

            const tx = new Transaction().add(eraseIx);

            // Set up for ER connection with session key
            tx.feePayer = sessionKey.keypair.publicKey;
            tx.recentBlockhash = (await erConnection.getLatestBlockhash()).blockhash;
            tx.sign(sessionKey.keypair);

            // Send using raw connection
            const txHash = await erConnection.sendRawTransaction(tx.serialize(), {
                skipPreflight: true,
            });
            await erConnection.confirmTransaction(txHash, "confirmed");

            return txHash;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to erase pixel on ER";
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [sessionProgram, sessionKey.keypair, erConnection]);

    // ========================================
    // Ephemeral Rollups Shard Functions
    // ========================================

    /**
     * Delegate a shard to Ephemeral Rollups for fast transactions
     */
    const delegateShard = useCallback(async (shardX: number, shardY: number): Promise<string> => {
        if (!program || !wallet.publicKey) {
            throw new Error("Wallet not connected");
        }

        if (shardX < 0 || shardX >= SHARDS_PER_DIM || shardY < 0 || shardY >= SHARDS_PER_DIM) {
            throw new Error(`Invalid shard coordinates: (${shardX}, ${shardY}). Must be 0-${SHARDS_PER_DIM - 1}`);
        }

        setIsLoading(true);
        setError(null);

        try {
            const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: PRIORITY_FEE_MICRO_LAMPORTS,
            });

            // MagicBlock devnet validator
            const DEVNET_VALIDATOR = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");

            const tx = await program.methods
                .delegateShard(shardX, shardY)
                .accounts({
                    authority: wallet.publicKey,
                })
                .remainingAccounts([
                    { pubkey: DEVNET_VALIDATOR, isSigner: false, isWritable: false }
                ])
                .preInstructions([priorityFeeIx])
                .rpc({
                    skipPreflight: true,
                });

            return tx;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to delegate shard";
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [program, wallet.publicKey]);

    /**
     * Delegate a shard using session key (no wallet popup needed)
     * Includes retry logic for transient failures
     */
    const delegateShardWithSession = useCallback(async (shardX: number, shardY: number): Promise<string> => {
        if (!sessionProgram || !sessionKey.keypair) {
            throw new Error("Session program or key not available");
        }

        if (shardX < 0 || shardX >= SHARDS_PER_DIM || shardY < 0 || shardY >= SHARDS_PER_DIM) {
            throw new Error(`Invalid shard coordinates: (${shardX}, ${shardY}). Must be 0-${SHARDS_PER_DIM - 1}`);
        }

        setIsLoading(true);
        setError(null);

        const maxAttempts = 3;
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`[delegateShardWithSession] Attempt ${attempt}/${maxAttempts} for shard (${shardX}, ${shardY})`);
                
                const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: PRIORITY_FEE_MICRO_LAMPORTS,
                });

                // MagicBlock devnet validators - use Asia region by default
                // Asia: MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57
                // EU: MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e
                const DEVNET_VALIDATOR = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
                
                // Build instruction using session program, sign with session key
                const delegateIx = await sessionProgram.methods
                    .delegateShard(shardX, shardY)
                    .accounts({
                        authority: sessionKey.keypair.publicKey,
                    })
                    .remainingAccounts([
                        { pubkey: DEVNET_VALIDATOR, isSigner: false, isWritable: false }
                    ])
                    .instruction();

                const tx = new Transaction()
                    .add(priorityFeeIx)
                    .add(delegateIx);

                tx.feePayer = sessionKey.keypair.publicKey;
                const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
                tx.recentBlockhash = blockhash;
                tx.sign(sessionKey.keypair);

                const txSig = await connection.sendRawTransaction(tx.serialize(), {
                    skipPreflight: true,
                });
                
                const confirmation = await connection.confirmTransaction(
                    { signature: txSig, blockhash, lastValidBlockHeight },
                    "confirmed"
                );
                
                // Check if transaction actually succeeded
                if (confirmation.value.err) {
                    const errStr = JSON.stringify(confirmation.value.err);
                    console.error(`[delegateShardWithSession] Transaction failed on attempt ${attempt}:`, errStr);
                    throw new Error(`Delegation failed: ${errStr}`);
                }

                console.log(`[delegateShardWithSession] SUCCESS on attempt ${attempt}: ${txSig}`);
                return txSig;
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                const errMsg = lastError.message;
                
                // Check if this is a retryable error
                const isRetryable = 
                    errMsg.includes("InvalidWritableAccount") ||
                    errMsg.includes("AccountNotFound") ||
                    errMsg.includes("blockhash") ||
                    errMsg.includes("timeout") ||
                    errMsg.includes("failed to send");
                
                if (isRetryable && attempt < maxAttempts) {
                    console.warn(`[delegateShardWithSession] Retryable error on attempt ${attempt}: ${errMsg}`);
                    // Wait before retry (2s, then 4s for exponential backoff)
                    await new Promise(r => setTimeout(r, attempt * 2000));
                    continue;
                }
                
                // Non-retryable error or max attempts reached
                console.error(`[delegateShardWithSession] Failed after ${attempt} attempts:`, errMsg);
                const message = lastError.message || "Failed to delegate shard";
                setError(message);
                throw lastError;
            }
        }

        // Should never reach here, but typescript needs it
        setIsLoading(false);
        throw lastError || new Error("Delegation failed after max attempts");
    }, [connection, sessionProgram, sessionKey.keypair]);

    /**
     * Initialize a shard at (shardX, shardY) and automatically delegate to ER
     * Shards are created on-demand when a user wants to paint in that region.
     * After initialization, the shard is automatically delegated to Ephemeral Rollups
     * for fast, low-cost pixel placement transactions.
     */
    /**
     * Initializes a shard if needed, using the session key.
     * After initialization, the shard is automatically delegated to Ephemeral Rollups
     * for fast, low-cost pixel placement transactions.
     * 
     * @param onStatusUpdate Optional callback for status updates (e.g. for loading UI)
     */
    const initializeShard = useCallback(async (
        shardX: number, 
        shardY: number,
        onStatusUpdate?: (status: string) => void
    ): Promise<string> => {
        if (!program || !sessionKey.keypair) {
            throw new Error("Program or session key not available");
        }

        if (shardX < 0 || shardX >= SHARDS_PER_DIM || shardY < 0 || shardY >= SHARDS_PER_DIM) {
            throw new Error(`Invalid shard coordinates: (${shardX}, ${shardY}). Must be 0-${SHARDS_PER_DIM - 1}`);
        }

        setIsLoading(true);
        setError(null);
        
        onStatusUpdate?.("Checking status...");

        try {
            const shardPDA = deriveShardPDA(shardX, shardY);
            
            // Step 1: Check if shard account exists
            const accountInfo = await connection.getAccountInfo(shardPDA);
            const shardExists = accountInfo !== null;
            
            // Step 2: Check delegation status if shard exists
            let isDelegated = false;
            if (shardExists) {
                isDelegated = accountInfo.owner.equals(DELEGATION_PROGRAM_ID);
                console.log(`Shard (${shardX}, ${shardY}) exists. Delegated: ${isDelegated}`);
            } else {
                console.log(`Shard (${shardX}, ${shardY}) does not exist, will initialize.`);
            }

            // Step 2.5: Calculate required balance and check before proceeding
            let requiredBalance = 0;
            if (!shardExists) {
                // Need to pay for shard account rent + init tx fee
                requiredBalance += SHARD_RENT_SOL + TX_FEE_SOL;
            }
            if (!isDelegated) {
                // Need to pay for delegation tx fee
                requiredBalance += DELEGATION_TX_FEE_SOL;
            }

            if (requiredBalance > 0) {
                // Check session key balance
                const sessionBalance = await connection.getBalance(sessionKey.keypair.publicKey);
                const sessionBalanceSOL = sessionBalance / 1e9; // Convert lamports to SOL
                
                if (sessionBalanceSOL < requiredBalance) {
                    const shortfall = requiredBalance - sessionBalanceSOL;
                    throw new Error(
                        `Insufficient session balance. Need ${requiredBalance.toFixed(4)} SOL but have ${sessionBalanceSOL.toFixed(4)} SOL. ` +
                        `Please top up at least ${shortfall.toFixed(4)} SOL to your session key.`
                    );
                }
                
                console.log(`Balance check passed: have ${sessionBalanceSOL.toFixed(4)} SOL, need ${requiredBalance.toFixed(4)} SOL`);
            }

            // Step 3: Initialize if needed
            if (!shardExists) {
                if (!sessionProgram) {
                    throw new Error("Session program not initialized");
                }
                
                onStatusUpdate?.("Unlocking Shard...");
                console.log(`Initializing shard (${shardX}, ${shardY})...`);
                const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports: PRIORITY_FEE_MICRO_LAMPORTS,
                });

                // Build transaction manually using session program (for IDL) 
                // and sign with session key
                const initIx = await sessionProgram.methods
                    .initializeShard(shardX, shardY)
                    .accounts({
                        authority: sessionKey.keypair.publicKey,
                        // session -> auto-derived from authority (session key)
                    })
                    .instruction();

                const tx = new Transaction()
                    .add(priorityFeeIx)
                    .add(initIx);

                tx.feePayer = sessionKey.keypair.publicKey;
                const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
                tx.recentBlockhash = blockhash;
                tx.sign(sessionKey.keypair);

                const initTxSig = await connection.sendRawTransaction(tx.serialize(), {
                    skipPreflight: true,
                });
                
                // Wait for confirmation
                const confirmation = await connection.confirmTransaction(
                    { signature: initTxSig, blockhash, lastValidBlockHeight },
                    "confirmed"
                );
                
                // Check if transaction actually succeeded (not just included in block)
                if (confirmation.value.err) {
                    console.error("Initialize shard transaction failed:", confirmation.value.err);
                    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
                }
                
                console.log("Initialized shard:", initTxSig);
                
                // After initialization, check again
                const newAccountInfo = await connection.getAccountInfo(shardPDA);
                if (newAccountInfo) {
                    isDelegated = newAccountInfo.owner.equals(DELEGATION_PROGRAM_ID);
                } else {
                    // Account still doesn't exist - something went wrong
                    throw new Error("Shard account not created after initialization");
                }
                
                // Wait for the account state to settle before delegation
                // Devnet can have propagation delays
                onStatusUpdate?.("Confirming...");
                console.log("Waiting for shard account to settle...");
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            // Step 4: Delegate if not already delegated
            if (!isDelegated) {
                onStatusUpdate?.("Delegating...");
                console.log(`Delegating shard (${shardX}, ${shardY})...`);
                
                try {
                    const delegateTx = await delegateShardWithSession(shardX, shardY);
                    console.log("Delegated shard:", delegateTx);
                    
                    // Wait for delegation to propagate to ER
                    console.log("Waiting for shard to appear on ER...");
                    onStatusUpdate?.("Speeding up with Magicblock...");

                    // Poll for up to 20 seconds (40 attempts)
                    // This ensures the UI stays in "Unlocking" state until truly ready on ER
                    for (let i = 0; i < 40; i++) {
                        const erShard = await fetchShardFromER(shardX, shardY);
                        if (erShard) {
                            console.log("Shard confirmed on ER");
                            break;
                        }
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    
                    return delegateTx;
                } catch (delegateErr) {
                    // Check if this is a stuck delegation state (InvalidAccountOwner on delegation_record)
                    const errStr = delegateErr instanceof Error ? delegateErr.message : String(delegateErr);
                    if (errStr.includes("InvalidAccountOwner")) {
                        // This can happen if a previous delegation partially failed
                        // The delegation records exist but the shard isn't delegated
                        console.error("Delegation failed - shard may be in a stuck state from a previous attempt");
                        throw new Error(
                            `This shard (${shardX}, ${shardY}) appears to be in a stuck delegation state from a previous attempt. ` +
                            "Please try a different shard, or contact support to clean up the state."
                        );
                    }
                    throw delegateErr;
                }
            } else {
                console.log(`Shard (${shardX}, ${shardY}) is already delegated.`);
                return "already-delegated";
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to initialize shard";
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [connection, sessionProgram, sessionKey.keypair, delegateShardWithSession]);

    /**
     * Commit shard state from ER to base layer
     * This is called on the ER to sync state back to Solana
     */
    const commitShard = useCallback(async (shardX: number, shardY: number): Promise<string> => {
        if (!program || !erProvider || !wallet.publicKey) {
            throw new Error("Wallet not connected or ER not available");
        }

        if (shardX < 0 || shardX >= SHARDS_PER_DIM || shardY < 0 || shardY >= SHARDS_PER_DIM) {
            throw new Error(`Invalid shard coordinates: (${shardX}, ${shardY}). Must be 0-${SHARDS_PER_DIM - 1}`);
        }

        setIsLoading(true);
        setError(null);

        try {
            // Build transaction using base program
            let tx = await program.methods
                .commitShard(shardX, shardY)
                .accounts({
                    payer: wallet.publicKey,
                })
                .transaction();

            // Set up for ER connection
            tx.feePayer = wallet.publicKey;
            tx.recentBlockhash = (await erConnection.getLatestBlockhash()).blockhash;
            tx = await erProvider.wallet.signTransaction(tx);

            // Send using raw connection
            const txHash = await erConnection.sendRawTransaction(tx.serialize(), {
                skipPreflight: true,
            });
            await erConnection.confirmTransaction(txHash, "confirmed");

            // Try to get the commitment signature on base layer
            try {
                const { GetCommitmentSignature } = await import("@magicblock-labs/ephemeral-rollups-sdk");
                const txCommitSgn = await GetCommitmentSignature(txHash, erConnection);
                console.log("Commit signature on base layer:", txCommitSgn);
            } catch {
                console.log("GetCommitmentSignature not available (might be expected on localnet)");
            }

            return txHash;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to commit shard";
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [program, erProvider, erConnection, wallet.publicKey]);

    // ========================================
    // Pixel Utility Functions
    // ========================================

    /**
     * Get a pixel color from shard data (8-bit direct indexing)
     * Returns 0-255 (0 = transparent, 1-255 = colors)
     */
    const getPixelFromShard = useCallback((shard: PixelShardAccount, localX: number, localY: number): number => {
        const localPixelId = localY * SHARD_DIMENSION + localX;

        if (localPixelId >= shard.pixels.length) {
            return 0;
        }

        return shard.pixels[localPixelId] ?? 0;
    }, []);

    /**
     * Get pixel color at global coordinates
     * Returns null if shard is not initialized
     */
    const getPixel = useCallback(async (px: number, py: number): Promise<number | null> => {
        const { shardX, shardY } = getShardForPixel(px, py);
        const shard = await fetchShard(shardX, shardY);
        
        if (!shard) return null;

        const localX = px % SHARD_DIMENSION;
        const localY = py % SHARD_DIMENSION;
        return getPixelFromShard(shard, localX, localY);
    }, [fetchShard, getPixelFromShard]);

    /**
     * Estimate the cost to unlock (initialize + delegate) a shard
     * Returns the cost in SOL based on current shard state
     */
    const estimateShardUnlockCost = useCallback(async (shardX: number, shardY: number): Promise<{
        total: number;
        breakdown: { initCost: number; delegateCost: number };
        needsInit: boolean;
        needsDelegate: boolean;
    }> => {
        const shardPDA = deriveShardPDA(shardX, shardY);
        const accountInfo = await connection.getAccountInfo(shardPDA);
        
        const needsInit = accountInfo === null;
        const needsDelegate = accountInfo === null || !accountInfo.owner.equals(DELEGATION_PROGRAM_ID);
        
        const initCost = needsInit ? (SHARD_RENT_SOL + TX_FEE_SOL) : 0;
        const delegateCost = needsDelegate ? DELEGATION_TX_FEE_SOL : 0;
        
        return {
            total: initCost + delegateCost,
            breakdown: { initCost, delegateCost },
            needsInit,
            needsDelegate,
        };
    }, [connection]);

    return {
        // Program instances
        program,
        readOnlyProgram,
        erProgram,
        readOnlyErProgram,
        erConnection,
        sessionActive, // Whether session key is available for signing

        // Loading/error state
        isLoading,
        error,

        // Shard query functions
        fetchShard,
        fetchShardFromER,
        checkShardDelegation,
        getAllDelegatedShards,

        // Shard management (initializeShard includes automatic delegation to ER)
        initializeShard,
        delegateShard,
        commitShard,
        estimateShardUnlockCost,

        // User session management
        initializeUser,
        delegateUser,
        checkUserDelegation, // Exporting this function
        deriveSessionPDA,
        fetchSessionAccount,
        checkCanPlacePixel,

        // Pixel operations (base layer)
        placePixel,
        erasePixel,

        // Pixel operations (Ephemeral Rollups)
        placePixelOnER,
        erasePixelOnER,

        // Utility functions
        deriveShardPDA,
        getShardForPixel,
        getPixelFromShard,
        getPixel,
    };
}
