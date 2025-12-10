import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Magicplace } from "../target/types/magicplace";

describe("fetch-data", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Magicplace as Program<Magicplace>;

  const SHARD_SEED = Buffer.from("shard");

  function deriveShardPDA(shardX: number, shardY: number): anchor.web3.PublicKey {
    const shardXBytes = Buffer.alloc(2);
    shardXBytes.writeUInt16LE(shardX);
    const shardYBytes = Buffer.alloc(2);
    shardYBytes.writeUInt16LE(shardY);
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [SHARD_SEED, shardXBytes, shardYBytes],
      program.programId
    );
    return pda;
  }

    it("fetches and logs data", async () => {
        console.log("Fetching program data...");
    
        // Fetch Shard 0,0
        const shardX = 0;
        const shardY = 0;
        const shardPDA = deriveShardPDA(shardX, shardY);
    
        console.log(`Checking for Shard (${shardX}, ${shardY}) at PDA: ${shardPDA.toString()}`);

        try {
            const shardAccount = await program.account.pixelShard.fetch(shardPDA);
            console.log("\n=== Shard Data ===");
            console.log(`Shard Coordinates: (${shardAccount.shardX}, ${shardAccount.shardY})`);
            console.log(`Creator: ${shardAccount.creator.toBase58()}`);
            console.log(`Pixel Data Length: ${shardAccount.pixels.length} bytes`);
            console.log(`Bump: ${shardAccount.bump}`);
      
            // visual check of first few bytes
            console.log("First 16 bytes of pixel data:", shardAccount.pixels.slice(0, 16));
            console.log("==================\n");

        } catch (error) {
            console.log(`Could not fetch shard account: ${error.message}`);
            console.log("Note: This is expected if the shard hasn't been initialized yet.");
        }

    });
});
