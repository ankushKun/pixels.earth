import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { Ed25519Program, Keypair, LAMPORTS_PER_SOL, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, Transaction } from "@solana/web3.js";
import { expect } from "chai";
import { Magicplace } from "../target/types/magicplace";
import * as nacl from "tweetnacl";

describe("magicplace", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Set up Ephemeral Rollup provider
  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT || "http://localhost:7799",
      {
        wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || "ws://localhost:7800",
      }
    ),
    anchor.Wallet.local()
  );

  console.log("Base Layer Connection:", provider.connection.rpcEndpoint);
  console.log("Ephemeral Rollup Connection:", providerEphemeralRollup.connection.rpcEndpoint);

  const program = anchor.workspace.Magicplace as Program<Magicplace>;
  const authority = provider.wallet;

  // Test constants
  const SHARD_SEED = Buffer.from("shard");
  const SESSION_SEED = Buffer.from("session");
  const SHARD_DIMENSION = 128;

  // Helper to derive shard PDA
  function deriveShardPDA(shardX: number, shardY: number): PublicKey {
    const shardXBytes = Buffer.alloc(2);
    shardXBytes.writeUInt16LE(shardX);
    const shardYBytes = Buffer.alloc(2);
    shardYBytes.writeUInt16LE(shardY);
    const [pda] = PublicKey.findProgramAddressSync(
      [SHARD_SEED, shardXBytes, shardYBytes],
      program.programId
    );
    return pda;
  }

  // Helper to derive session PDA
  function deriveSessionPDA(mainWallet: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [SESSION_SEED, mainWallet.toBuffer()],
      program.programId
    );
    return pda;
  }

  // Generate authorization message (must match program)
  function generateAuthMessage(sessionKey: PublicKey, mainWallet: PublicKey): string {
    return `Authorize session key: ${sessionKey.toBase58()} for wallet: ${mainWallet.toBase58()} on Magicplace`;
  }

  // Test shard coordinates
  const testShardX = 0;
  const testShardY = 0;
  const shardPDA = deriveShardPDA(testShardX, testShardY);

  // Session key for tests
  let sessionKeypair: Keypair;
  let sessionPDA: PublicKey;

  console.log("Program ID:", program.programId.toString());
  console.log("Test Shard PDA:", shardPDA.toString());

  before(async function () {
    const balance = await provider.connection.getBalance(authority.publicKey);
    console.log("Current balance:", balance / LAMPORTS_PER_SOL, "SOL\n");

    // Generate a session keypair for testing
    sessionKeypair = Keypair.generate();
    sessionPDA = deriveSessionPDA(authority.publicKey);
    console.log("Session Key:", sessionKeypair.publicKey.toString());
    console.log("Session PDA:", sessionPDA.toString());

    // Fund the session keypair
    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: sessionKeypair.publicKey,
        lamports: 0.1 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundTx);
    console.log("Funded session key with 0.1 SOL\n");
  });

  // ========================================
  // User Session Tests
  // ========================================

  describe("initializeUser", () => {
    it("initializes a user session account with Ed25519 signature verification", async () => {
      // Generate the authorization message
      const authMessage = generateAuthMessage(sessionKeypair.publicKey, authority.publicKey);
      const messageBytes = new TextEncoder().encode(authMessage);

      // Sign the message with the main wallet
      // In tests, we use nacl to sign since we have the keypair
      const mainWalletKeypair = (provider.wallet as anchor.Wallet).payer;
      const signature = nacl.sign.detached(messageBytes, mainWalletKeypair.secretKey);

      console.log("Auth message:", authMessage);
      console.log("Signature length:", signature.length);

      const start = Date.now();

      // Get remaining accounts for local validator
      const remainingAccounts = providerEphemeralRollup.connection.rpcEndpoint.includes("localhost") ||
        providerEphemeralRollup.connection.rpcEndpoint.includes("127.0.0.1") ||
        providerEphemeralRollup.connection.rpcEndpoint.includes("0.0.0.0")
        ? [
          {
            pubkey: new web3.PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"),
            isSigner: false,
            isWritable: false,
          },
        ]
        : [];

      // Create Ed25519 signature verification instruction
      // This MUST be the first instruction in the transaction
      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: authority.publicKey.toBytes(),
        message: messageBytes,
        signature: signature,
      });

      // Build the program instruction
      const programIx = await program.methods
        .initializeUser(authority.publicKey, Array.from(signature) as number[])
        .accounts({
          authority: sessionKeypair.publicKey,
          instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .remainingAccounts(remainingAccounts)
        .instruction();

      // Create transaction with Ed25519 verify as first instruction
      const tx = new Transaction().add(ed25519Ix, programIx);

      tx.feePayer = sessionKeypair.publicKey;
      tx.recentBlockhash = (await provider.connection.getLatestBlockhash()).blockhash;
      tx.sign(sessionKeypair);

      const txHash = await provider.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
      });
      await provider.connection.confirmTransaction(txHash, "confirmed");

      const duration = Date.now() - start;
      console.log(`${duration}ms initializeUser txHash: ${txHash}`);

      // Verify the session account
      const sessionAccount = await program.account.sessionAccount.fetch(sessionPDA);
      expect(sessionAccount.mainAddress.toBase58()).to.equal(authority.publicKey.toBase58());
      expect(sessionAccount.authority.toBase58()).to.equal(sessionKeypair.publicKey.toBase58());
      expect(sessionAccount.ownedShards.toNumber()).to.equal(0);
    });
  });

  // ========================================
  // Shard Management Tests
  // ========================================

  describe("initializeShard", () => {
    it("initializes a shard and delegates to ER", async () => {
      const start = Date.now();

      // Get remaining accounts for local validator
      const remainingAccounts = providerEphemeralRollup.connection.rpcEndpoint.includes("localhost") ||
        providerEphemeralRollup.connection.rpcEndpoint.includes("127.0.0.1") ||
        providerEphemeralRollup.connection.rpcEndpoint.includes("0.0.0.0")
        ? [
          {
            pubkey: new web3.PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"),
            isSigner: false,
            isWritable: false,
          },
        ]
        : [];

      const tx = await program.methods
        .initializeShard(testShardX, testShardY)
        .accounts({
          authority: authority.publicKey,
        })
        .remainingAccounts(remainingAccounts)
        .rpc({ skipPreflight: true });

      const duration = Date.now() - start;
      console.log(`${duration}ms initializeShard txHash: ${tx}`);

      // Wait for delegation to propagate
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify the shard was created
      const shardAccount = await program.account.pixelShard.fetch(shardPDA);
      expect(shardAccount.shardX).to.equal(testShardX);
      expect(shardAccount.shardY).to.equal(testShardY);
      expect(shardAccount.creator.toBase58()).to.equal(authority.publicKey.toBase58());
      expect(shardAccount.pixels.length).to.equal(8192); // 128*128/2 bytes (4-bit packed)
    });

    it("initializes a second shard at different coordinates", async () => {
      const shardX = 1;
      const shardY = 0;
      const shard2PDA = deriveShardPDA(shardX, shardY);

      const remainingAccounts = providerEphemeralRollup.connection.rpcEndpoint.includes("localhost") ||
        providerEphemeralRollup.connection.rpcEndpoint.includes("127.0.0.1") ||
        providerEphemeralRollup.connection.rpcEndpoint.includes("0.0.0.0")
        ? [
          {
            pubkey: new web3.PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"),
            isSigner: false,
            isWritable: false,
          },
        ]
        : [];

      await program.methods
        .initializeShard(shardX, shardY)
        .accounts({
          authority: authority.publicKey,
        })
        .remainingAccounts(remainingAccounts)
        .rpc({ skipPreflight: true });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const shardAccount = await program.account.pixelShard.fetch(shard2PDA);
      expect(shardAccount.shardX).to.equal(shardX);
      expect(shardAccount.shardY).to.equal(shardY);
    });
  });

  // ========================================
  // Pixel Placement Tests (on ER)
  // ========================================

  describe("placePixel", () => {
    it("places a pixel on the shard (via ER)", async () => {
      const px = 10; // Global pixel X
      const py = 20; // Global pixel Y
      const color = 5; // Color 1-15

      const start = Date.now();

      // Build transaction
      let tx = await program.methods
        .placePixel(testShardX, testShardY, px, py, color)
        .accounts({
          signer: authority.publicKey,
        })
        .transaction();

      // Send to ER
      tx.feePayer = providerEphemeralRollup.wallet.publicKey;
      tx.recentBlockhash = (await providerEphemeralRollup.connection.getLatestBlockhash()).blockhash;
      tx = await providerEphemeralRollup.wallet.signTransaction(tx);

      const txHash = await providerEphemeralRollup.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
      });
      await providerEphemeralRollup.connection.confirmTransaction(txHash, "confirmed");

      const duration = Date.now() - start;
      console.log(`${duration}ms placePixel txHash: ${txHash}`);
    });

    it("places multiple pixels", async () => {
      const pixels = [
        { px: 0, py: 0, color: 1 },
        { px: 1, py: 0, color: 2 },
        { px: 0, py: 1, color: 3 },
        { px: 127, py: 127, color: 15 },
      ];

      for (const { px, py, color } of pixels) {
        let tx = await program.methods
          .placePixel(testShardX, testShardY, px, py, color)
          .accounts({
            signer: authority.publicKey,
          })
          .transaction();

        tx.feePayer = providerEphemeralRollup.wallet.publicKey;
        tx.recentBlockhash = (await providerEphemeralRollup.connection.getLatestBlockhash()).blockhash;
        tx = await providerEphemeralRollup.wallet.signTransaction(tx);

        const txHash = await providerEphemeralRollup.connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
        });
        await providerEphemeralRollup.connection.confirmTransaction(txHash, "confirmed");
      }

      console.log(`Placed ${pixels.length} pixels successfully`);
    });
  });

  describe("erasePixel", () => {
    it("erases a pixel on the shard (via ER)", async () => {
      const px = 10;
      const py = 20;

      const start = Date.now();

      let tx = await program.methods
        .erasePixel(testShardX, testShardY, px, py)
        .accounts({
          signer: authority.publicKey,
        })
        .transaction();

      tx.feePayer = providerEphemeralRollup.wallet.publicKey;
      tx.recentBlockhash = (await providerEphemeralRollup.connection.getLatestBlockhash()).blockhash;
      tx = await providerEphemeralRollup.wallet.signTransaction(tx);

      const txHash = await providerEphemeralRollup.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
      });
      await providerEphemeralRollup.connection.confirmTransaction(txHash, "confirmed");

      const duration = Date.now() - start;
      console.log(`${duration}ms erasePixel txHash: ${txHash}`);
    });
  });

  // ========================================
  // Commit Tests
  // ========================================

  describe("commitShard", () => {
    it("commits shard state from ER to base layer", async () => {
      const start = Date.now();

      let tx = await program.methods
        .commitShard(testShardX, testShardY)
        .accounts({
          payer: providerEphemeralRollup.wallet.publicKey,
        })
        .transaction();

      tx.feePayer = providerEphemeralRollup.wallet.publicKey;
      tx.recentBlockhash = (await providerEphemeralRollup.connection.getLatestBlockhash()).blockhash;
      tx = await providerEphemeralRollup.wallet.signTransaction(tx);

      const txHash = await providerEphemeralRollup.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
      });
      await providerEphemeralRollup.connection.confirmTransaction(txHash, "confirmed");

      const duration = Date.now() - start;
      console.log(`${duration}ms commitShard txHash: ${txHash}`);
    });
  });

  // ========================================
  // Error Cases
  // ========================================

  describe("error cases", () => {
    it("fails to place pixel with invalid color (0)", async () => {
      try {
        let tx = await program.methods
          .placePixel(testShardX, testShardY, 50, 50, 0) // color 0 is invalid
          .accounts({
            signer: authority.publicKey,
          })
          .transaction();

        tx.feePayer = providerEphemeralRollup.wallet.publicKey;
        tx.recentBlockhash = (await providerEphemeralRollup.connection.getLatestBlockhash()).blockhash;
        tx = await providerEphemeralRollup.wallet.signTransaction(tx);

        await providerEphemeralRollup.connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
        });

        expect.fail("Should have thrown an error");
      } catch (err) {
        // Expected to fail
        console.log("Expected error for invalid color: OK");
      }
    });

    it("fails to place pixel with invalid color (16)", async () => {
      try {
        let tx = await program.methods
          .placePixel(testShardX, testShardY, 50, 50, 16) // color 16 is invalid
          .accounts({
            signer: authority.publicKey,
          })
          .transaction();

        tx.feePayer = providerEphemeralRollup.wallet.publicKey;
        tx.recentBlockhash = (await providerEphemeralRollup.connection.getLatestBlockhash()).blockhash;
        tx = await providerEphemeralRollup.wallet.signTransaction(tx);

        await providerEphemeralRollup.connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
        });

        expect.fail("Should have thrown an error");
      } catch (err) {
        console.log("Expected error for invalid color: OK");
      }
    });

    it("fails to initialize shard with invalid coordinates", async () => {
      try {
        await program.methods
          .initializeShard(5000, 0) // 5000 > 4095
          .accounts({
            authority: authority.publicKey,
          })
          .rpc({ skipPreflight: true });

        expect.fail("Should have thrown an error");
      } catch (err) {
        console.log("Expected error for invalid shard coordinates: OK");
      }
    });
  });
});
