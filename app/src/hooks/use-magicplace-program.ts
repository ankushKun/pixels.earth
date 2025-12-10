import { useCallback, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Program, AnchorProvider, setProvider } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { type Magicplace } from "../idl/magicplace";
import IDL from "../idl/magicplace.json";
import { SHARD_DIMENSION, SHARDS_PER_DIM } from "../constants";

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

// Ephemeral Rollup endpoints - configurable via environment
const ER_ENDPOINT = "https://devnet.magicblock.app";
const ER_WS_ENDPOINT = "wss://devnet.magicblock.app";

// Delegation status
export type DelegationStatus = "undelegated" | "delegated" | "checking";

// Seed prefix for shard PDAs (must match contract: b"shard")
const SHARD_SEED = Buffer.from("shard");

// Seed prefix for session account PDAs (must match contract: b"session")
const SESSION_SEED = Buffer.from("session");

// Delegation Program ID
const DELEGATION_PROGRAM_ID = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

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
 * Derive the PDA for a session account based on the main wallet
 */
export function deriveSessionPDA(mainWallet: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [SESSION_SEED, mainWallet.toBuffer()],
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

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Base layer Anchor provider and program
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

    // Ephemeral Rollup connection and provider
    const erConnection = useMemo(() => {
        return new Connection(ER_ENDPOINT, {
            wsEndpoint: ER_WS_ENDPOINT,
            commitment: "confirmed",
        });
    }, []);

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

    const erProgram = useMemo(() => {
        if (!erProvider) {
            return null;
        }

        return new Program<Magicplace>(IDL as Magicplace, erProvider);
    }, [erProvider]);

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
     * Check if a shard is delegated to Ephemeral Rollups
     */
    const checkShardDelegation = useCallback(async (shardX: number, shardY: number): Promise<DelegationStatus> => {
        const shardPDA = deriveShardPDA(shardX, shardY);
        
        try {
            const accountInfo = await connection.getAccountInfo(shardPDA);
            
            if (!accountInfo) {
                return "undelegated"; // Account doesn't exist
            }

            // Check if the account owner is the delegation program
            return accountInfo.owner.equals(DELEGATION_PROGRAM_ID) ? "delegated" : "undelegated";
        } catch (err) {
            console.error("Error checking shard delegation:", err);
            return "undelegated";
        }
    }, [connection]);

    /**
     * Fetch a shard from Ephemeral Rollups (when delegated)
     */
    const fetchShardFromER = useCallback(async (shardX: number, shardY: number): Promise<PixelShardAccount | null> => {
        if (!erProgram) return null;

        try {
            const shardPDA = deriveShardPDA(shardX, shardY);
            const account = await erProgram.account.pixelShard.fetch(shardPDA);
            return {
                shardX: account.shardX,
                shardY: account.shardY,
                pixels: new Uint8Array(account.pixels),
                creator: account.creator,
                bump: account.bump,
            };
        } catch (err) {
            console.debug(`Shard (${shardX}, ${shardY}) not found on ER`);
            return null;
        }
    }, [erProgram]);

    // ========================================
    // Shard Management Functions
    // ========================================

    /**
     * Initialize a shard at (shardX, shardY) and automatically delegate to ER
     * Shards are created on-demand when a user wants to paint in that region.
     * After initialization, the shard is automatically delegated to Ephemeral Rollups
     * for fast, low-cost pixel placement transactions.
     */
    const initializeShard = useCallback(async (shardX: number, shardY: number): Promise<string> => {
        if (!program || !wallet.publicKey) {
            throw new Error("Wallet not connected");
        }

        if (shardX < 0 || shardX >= SHARDS_PER_DIM || shardY < 0 || shardY >= SHARDS_PER_DIM) {
            throw new Error(`Invalid shard coordinates: (${shardX}, ${shardY}). Must be 0-${SHARDS_PER_DIM - 1}`);
        }

        setIsLoading(true);
        setError(null);

        try {
            const tx = await program.methods
                .initializeShard(shardX, shardY)
                .accounts({
                    authority: wallet.publicKey,
                })
                .rpc({
                    skipPreflight: true, // Required for delegation CPI
                });

            // Wait for delegation to propagate to ER
            await new Promise(resolve => setTimeout(resolve, 2000));

            return tx;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to initialize shard";
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [program, wallet.publicKey]);

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
                    instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
                })
                .instruction();
            
            // Create transaction with Ed25519 verify as first instruction
            const tx = new Transaction().add(ed25519Ix, programIx);
            
            // Set up transaction
            tx.feePayer = sessionKeypair.publicKey;
            tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

            // Sign with session keypair
            tx.sign(sessionKeypair);

            // Send transaction
            const signature = await connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: true, // Required for Ed25519 instruction
            });
            await connection.confirmTransaction(signature, "confirmed");

            return signature;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to initialize user";
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [program, connection]);

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

        if (color < 1 || color > 15) {
            throw new Error(`Invalid color: ${color}. Must be 1-15`);
        }

        const { shardX, shardY } = getShardForPixel(px, py);

        setIsLoading(true);
        setError(null);

        try {
            const tx = await program.methods
                .placePixel(shardX, shardY, px, py, color)
                .accounts({
                    signer: wallet.publicKey,
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
     */
    const placePixelOnER = useCallback(async (px: number, py: number, color: number): Promise<string> => {
        if (!program || !erProvider || !wallet.publicKey) {
            throw new Error("Wallet not connected or ER not available");
        }

        if (color < 1 || color > 15) {
            throw new Error(`Invalid color: ${color}. Must be 1-15`);
        }

        const { shardX, shardY } = getShardForPixel(px, py);

        setIsLoading(true);
        setError(null);

        try {
            // Build transaction using base program
            let tx = await program.methods
                .placePixel(shardX, shardY, px, py, color)
                .accounts({
                    signer: wallet.publicKey,
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

            return txHash;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to place pixel on ER";
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [program, erProvider, erConnection, wallet.publicKey]);

    /**
     * Erase a pixel on Ephemeral Rollups (when shard is delegated)
     */
    const erasePixelOnER = useCallback(async (px: number, py: number): Promise<string> => {
        if (!program || !erProvider || !wallet.publicKey) {
            throw new Error("Wallet not connected or ER not available");
        }

        const { shardX, shardY } = getShardForPixel(px, py);

        setIsLoading(true);
        setError(null);

        try {
            // Build transaction using base program
            let tx = await program.methods
                .erasePixel(shardX, shardY, px, py)
                .accounts({
                    signer: wallet.publicKey,
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

            return txHash;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to erase pixel on ER";
            setError(message);
            throw err;
        } finally {
            setIsLoading(false);
        }
    }, [program, erProvider, erConnection, wallet.publicKey]);

    // ========================================
    // Ephemeral Rollups Shard Functions
    // ========================================

    // /**
    //  * Delegate a shard to Ephemeral Rollups for fast transactions
    //  * NOTE: This is typically not needed as initializeShard automatically delegates.
    //  * Use this only if a shard needs to be re-delegated after undelegation.
    //  */
    // const delegateShard = useCallback(async (shardX: number, shardY: number): Promise<string> => {
    //     if (!program || !wallet.publicKey) {
    //         throw new Error("Wallet not connected");
    //     }

    //     if (shardX < 0 || shardX >= SHARDS_PER_DIM || shardY < 0 || shardY >= SHARDS_PER_DIM) {
    //         throw new Error(`Invalid shard coordinates: (${shardX}, ${shardY}). Must be 0-${SHARDS_PER_DIM - 1}`);
    //     }

    //     setIsLoading(true);
    //     setError(null);

    //     try {
    //         const tx = await program.methods
    //             .delegateShard(shardX, shardY)
    //             .accounts({
    //                 payer: wallet.publicKey,
    //             })
    //             .rpc({
    //                 skipPreflight: true,
    //             });

    //         // Wait for delegation to propagate
    //         await new Promise(resolve => setTimeout(resolve, 2000));

    //         return tx;
    //     } catch (err) {
    //         const message = err instanceof Error ? err.message : "Failed to delegate shard";
    //         setError(message);
    //         throw err;
    //     } finally {
    //         setIsLoading(false);
    //     }
    // }, [program, wallet.publicKey]);

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
     * Get a pixel color from shard data (4-bit packed)
     * Returns 0-15 (0 = transparent, 1-15 = colors)
     */
    const getPixelFromShard = useCallback((shard: PixelShardAccount, localX: number, localY: number): number => {
        const localPixelId = localY * SHARD_DIMENSION + localX;
        const byteIndex = Math.floor(localPixelId / 2);
        const isHighNibble = localPixelId % 2 === 0;

        if (byteIndex >= shard.pixels.length) {
            return 0;
        }

        const byte = shard.pixels[byteIndex];
        if (byte === undefined) {
            return 0;
        }
        return isHighNibble ? (byte >> 4) & 0x0F : byte & 0x0F;
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

    return {
        // Program instances
        program,
        erProgram,
        erConnection,

        // Loading/error state
        isLoading,
        error,

        // Shard query functions
        fetchShard,
        fetchShardFromER,
        checkShardDelegation,

        // Shard management (initializeShard includes automatic delegation to ER)
        initializeShard,
        // delegateShard, // For re-delegation only
        commitShard,

        // User session management
        initializeUser,
        deriveSessionPDA,

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
