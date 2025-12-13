import { Connection, Keypair } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, EventParser } from "@coral-xyz/anchor";
import db from "./db";
import idl from "../idl/magicplace.json";
import { SHARD_DIMENSION } from "../constants";

// Constants
const BASE_RPC = "https://api.devnet.solana.com";
const ER_RPC = "https://devnet.magicblock.app"; 

// Generic Connections
const baseConnection = new Connection(BASE_RPC, "confirmed");
const erConnection = new Connection(ER_RPC, "confirmed");

// Dummy Wallet
const dummyWallet = new Wallet(Keypair.generate());

// Providers and Programs
const baseProvider = new AnchorProvider(baseConnection, dummyWallet, { commitment: "confirmed" });
// @ts-ignore
const baseProgram = new Program(idl, baseProvider);

const erProvider = new AnchorProvider(erConnection, dummyWallet, { commitment: "confirmed" });
// @ts-ignore
const erProgram = new Program(idl, erProvider);

// DB update helpers
function updatePixelStats(event: any) {
    const { px, py, color, painter, mainWallet, timestamp } = event;
    const wallet = mainWallet.toBase58();
    const pxNum = Number(px);
    const pyNum = Number(py);
    const timestampNum = timestamp.toNumber();
    
    console.log(`[Pixel] (${pxNum},${pyNum}) Color:${color} by ${wallet.slice(0, 8)}...`);

    db.prepare('UPDATE global_stats SET total_pixels_placed = total_pixels_placed + 1 WHERE id = 1').run();
    
    // Insert pixel event
    db.prepare(`
        INSERT INTO pixel_events (px, py, color, main_wallet, timestamp)
        VALUES (?, ?, ?, ?, ?)
    `).run(pxNum, pyNum, color, wallet, timestampNum);

    db.prepare(`
        INSERT INTO users (main_wallet, pixels_placed_count) 
        VALUES (?, 1) 
        ON CONFLICT(main_wallet) 
        DO UPDATE SET pixels_placed_count = pixels_placed_count + 1
    `).run(wallet);

    // Update Session Address if delegated (painter != mainWallet)
    const session = painter.toBase58();
    if (session !== wallet) {
        try {
            db.prepare('UPDATE users SET session_address = ? WHERE main_wallet = ?').run(session, wallet);
        } catch (e) {
             // ignore
        }
    }
}

function updateShardStats(event: any) {
    const { shardX, shardY, creator, mainWallet, timestamp } = event;
    const wallet = mainWallet.toBase58();
    const shardXNum = Number(shardX);
    const shardYNum = Number(shardY);
    const timestampNum = timestamp.toNumber();
    
    console.log(`[Shard] (${shardXNum},${shardYNum}) Init by ${wallet.slice(0, 8)}...`);

    try {
        db.prepare(`
            INSERT INTO shards (shard_x, shard_y, main_wallet, timestamp) 
            VALUES (?, ?, ?, ?)
        `).run(shardXNum, shardYNum, wallet, timestampNum);

        db.prepare('UPDATE global_stats SET total_shards_deployed = total_shards_deployed + 1 WHERE id = 1').run();

        db.prepare(`
            INSERT INTO users (main_wallet, shards_owned_count) 
            VALUES (?, 1) 
            ON CONFLICT(main_wallet) 
            DO UPDATE SET shards_owned_count = shards_owned_count + 1
        `).run(wallet);

    } catch (e: any) {
        if (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
            // Already indexed
        } else {
            console.error("Error indexing shard:", e);
        }
    }
}

// Listener Setup
function setupListener(connection: Connection, program: Program, label: string) {
    console.log(`📡 Subscribing to ${label} logs...`);
    
    connection.onLogs(
        program.programId,
        (logs, ctx) => {
            if (logs.err) return; // Skip failed tx
            const signature = logs.signature;
            
            // Deduplication check
            const seen = db.prepare('SELECT 1 FROM processed_sigs WHERE signature = ?').get(signature);
            if (seen) return;

            const parser = new EventParser(program.programId, program.coder);
            const events = [...parser.parseLogs(logs.logs)];
            
            if (events.length === 0) return;

            try {
                // Transactional update
                db.transaction(() => {
                    for (const event of events) {
                        if (event.name === "pixelChanged") {
                            updatePixelStats(event.data);
                        } else if (event.name === "shardInitialized") {
                            updateShardStats(event.data);
                        }
                    }
                    db.prepare('INSERT INTO processed_sigs (signature, processed_at) VALUES (?, ?)').run(signature, Date.now());
                })();
            } catch (e) {
                console.error(`Error processing tx ${signature}:`, e);
            }
        },
        "confirmed"
    );
}

// Historical Backfill
async function backfillLogs(connection: Connection, program: Program, label: string) {
    console.log(`⏳ Starting backfill for ${label}...`);
    
    // Get last sync point
    const syncState: any = db.prepare('SELECT last_signature FROM sync_state WHERE label = ?').get(label);
    const until = syncState?.last_signature;
    
    let before: string | undefined = undefined;
    let totalProcessed = 0;

    // Fetch in batches
    while (true) {
        try {
            const signatures = await connection.getSignaturesForAddress(
                program.programId,
                { limit: 100, before, until },
                "confirmed"
            );

            if (signatures.length === 0) break;

            const latestSignature = signatures[0]?.signature;
            if (!latestSignature) break;

            // Optimistically update sync state with the most recent signature found in this batch (or first overall)
            if (!before && !until) {
                 db.prepare(`
                    INSERT INTO sync_state (label, last_signature, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(label) DO UPDATE SET last_signature = ?, updated_at = ?
                `).run(label, latestSignature, Date.now(), latestSignature, Date.now());
            }

            // Process signatures in reverse (oldest first)
            // Create a copy to avoid mutating the original array which determines our "next batch" cursor.
            const txsToProcess = [...signatures].reverse();

            for (const sigInfo of txsToProcess) {
                if (sigInfo.err) continue;
                
                const signature = sigInfo.signature;
                if (!signature) continue;

                const seen = db.prepare('SELECT 1 FROM processed_sigs WHERE signature = ?').get(signature);
                if (seen) {
                    continue;
                }

                // Fetch tx details
                const tx = await connection.getTransaction(signature, {
                    maxSupportedTransactionVersion: 0,
                    commitment: "confirmed"
                });

                if (!tx || !tx.meta || tx.meta.err) continue;

                const parser = new EventParser(program.programId, program.coder);
                const events = [...parser.parseLogs(tx.meta.logMessages || [])];

                if (events.length > 0) {
                     db.transaction(() => {
                        for (const event of events) {
                            if (event.name === "pixelChanged") {
                                updatePixelStats(event.data);
                            } else if (event.name === "shardInitialized") {
                                updateShardStats(event.data);
                            }
                        }
                        db.prepare('INSERT INTO processed_sigs (signature, processed_at) VALUES (?, ?)').run(signature, Date.now());
                    })();
                    totalProcessed++;
                }
            }

            // Set cursor to the oldest signature in the fetched batch
            const oldestSig = signatures[signatures.length - 1]?.signature;
            if (!oldestSig) break;
            
            before = oldestSig;
            
            console.log(`   Processed ${signatures.length} sigs for ${label} (Total: ${totalProcessed})`);

            // Rate limit protection
            await new Promise(r => setTimeout(r, 2000));

        } catch (e) {
            console.error(`Backfill failed for ${label}:`, e);
            break; 
        }
    }
    console.log(`✅ Backfill complete for ${label}. Processed ${totalProcessed} txs.`);
}

let isRunning = false;
export async function startIndexer() {
    if (isRunning) return;
    isRunning = true;
    console.log("🚀 Starting MagicPlace Analytics Indexer (Embedded)...");
    
    // Start listeners immediately for new events
    setupListener(baseConnection, baseProgram, "Base Layer");
    setupListener(erConnection, erProgram, "Ephemeral Rollups");

    // Run backfill in background
    console.log("Starting background backfill...");
    await Promise.all([
        backfillLogs(baseConnection, baseProgram, "Base Layer"),
        backfillLogs(erConnection, erProgram, "Ephemeral Rollups")
    ]);
}
