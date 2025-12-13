use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{self, load_instruction_at_checked};

/// Ed25519 program ID: Ed25519SigVerify111111111111111111111111111
const ED25519_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    3, 125, 70, 214, 124, 147, 251, 190, 18, 249, 66, 143,
    131, 141, 64, 255, 5, 112, 116, 73, 39, 244, 138, 100,
    252, 202, 112, 68, 128, 0, 0, 0,
]);
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_accounts;

declare_id!("4j29Do6VWdMhfLBdi4n3AeWdVXNEzJNG72sFVUe9cUSe");

const DELEGATION_PROGRAM_ID: Pubkey = pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

// ========================================
// Canvas Configuration - 524,288 x 524,288 with dynamic sharding
// ========================================

/// Total canvas resolution per dimension (2^19 = 524,288)
const CANVAS_RES: u32 = 524288;

/// Each shard is 90x90 pixels
const SHARD_DIMENSION: u32 = 90;

/// Number of shards per dimension (ceiling division: 524,288 / 90 = 5,826)
const SHARDS_PER_DIM: u32 = (CANVAS_RES + SHARD_DIMENSION - 1) / SHARD_DIMENSION;

/// Total pixels stored in each shard (90 * 90 = 8,100)
const PIXELS_PER_SHARD: usize = (SHARD_DIMENSION * SHARD_DIMENSION) as usize;

/// Bytes needed to store pixels (1 byte per pixel using 8-bit colors)
const BYTES_PER_SHARD: usize = PIXELS_PER_SHARD;

/// Seed prefix for shard PDAs
const SHARD_SEED: &[u8] = b"shard";

/// Available colors using 8-bit storage (0 = unset/transparent, 1-255 = palette colors)
const AVAILABLE_COLORS: u8 = 255;

/// Max pixels allowed in a burst for non-owners
const COOLDOWN_LIMIT: u8 = 50;

/// Cooldown period in seconds resetting the burst counter
const COOLDOWN_PERIOD: u64 = 30;

#[ephemeral]
#[program]
pub mod magicplace {
    use super::*;

    pub fn initialize_user(
        ctx: Context<InitializeUser>,
        main_wallet: Pubkey,
        _signature: [u8; 64],
    ) -> Result<()> {
        // Verify Ed25519 signature using Solana's native Ed25519 program
        // The frontend must include an Ed25519 verify instruction as the first instruction
        // in the transaction. This program reads the instructions sysvar to verify it.
        
        let ix_sysvar = &ctx.accounts.instructions_sysvar;
        
        // Load the first instruction (index 0) - should be the Ed25519 verify instruction
        let ed25519_ix = load_instruction_at_checked(0, ix_sysvar)
            .map_err(|_| PixelError::InvalidAuth)?;
        
        // Verify it's from the Ed25519 program
        require!(
            ed25519_ix.program_id == ED25519_PROGRAM_ID,
            PixelError::InvalidAuth
        );
        
        // Parse the Ed25519 instruction data to verify the signature matches
        let ix_data = &ed25519_ix.data;
        require!(ix_data.len() >= 2, PixelError::InvalidAuth);
        
        let num_signatures = ix_data[0];
        require!(num_signatures >= 1, PixelError::InvalidAuth);
        
        // Parse the first signature header (starts at offset 2)
        require!(ix_data.len() >= 18, PixelError::InvalidAuth); // 2 + 16 bytes header
        
        let pubkey_offset = u16::from_le_bytes([ix_data[6], ix_data[7]]) as usize;
        
        // Extract the public key from the instruction data
        require!(ix_data.len() >= pubkey_offset + 32, PixelError::InvalidAuth);
        let pubkey_bytes = &ix_data[pubkey_offset..pubkey_offset + 32];
        let verified_pubkey = Pubkey::try_from(pubkey_bytes)
            .map_err(|_| PixelError::InvalidAuth)?;
        
        // Verify the public key matches the main_wallet
        require!(
            verified_pubkey == main_wallet,
            PixelError::InvalidAuth
        );
        
        msg!("Ed25519 signature verified for main wallet: {}", main_wallet);
        
        // Initialize the session account
        let user = &mut ctx.accounts.user;
        user.main_address = main_wallet;
        user.authority = ctx.accounts.authority.key();
        user.cooldown_counter = 0;
        user.last_place_timestamp = 0;
        user.bump = ctx.bumps.user;
        
        msg!("Session account initialized for main wallet: {}", main_wallet);
        Ok(())
    }

    /// Delegate a user session account to Ephemeral Rollups
    /// This should be called after initialize_user in a separate transaction
    pub fn delegate_user(
        ctx: Context<DelegateUser>,
        main_wallet: Pubkey,
    ) -> Result<()> {
        // Verify the caller is the authorized session key
        require!(
            ctx.accounts.user.authority == ctx.accounts.authority.key(),
            PixelError::InvalidAuth
        );
        
        // Delegate the session account to Ephemeral Rollups
        ctx.accounts.delegate_pda(
            &ctx.accounts.authority,
            &[b"session", ctx.accounts.authority.key().as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        
        msg!("Session account delegated to ER for wallet: {}", main_wallet);
        Ok(())
    }

    // ========================================
    // Shard Management
    // ========================================

    /// Initialize a shard at (shard_x, shard_y) coordinates (without delegation)
    /// Shards are created on-demand when a user wants to paint in that region
    /// shard_x, shard_y: 0-4095 (4096 shards per dimension)
    /// Call delegate_shard separately after this to delegate to ER
    pub fn initialize_shard(
        ctx: Context<InitializeShard>, 
        shard_x: u16, 
        shard_y: u16
    ) -> Result<()> {
        require!(
            (shard_x as u32) < SHARDS_PER_DIM && (shard_y as u32) < SHARDS_PER_DIM,
            PixelError::InvalidShardCoord
        );
        
        // Handle session account (potentially delegated)
        let session_info = &ctx.accounts.session;
        require!(
            session_info.owner == &crate::ID || session_info.owner == &DELEGATION_PROGRAM_ID,
            PixelError::InvalidAuth
        );
        
        let session = SessionAccount::try_deserialize(&mut &session_info.data.borrow()[..])?;
        
        let shard = &mut ctx.accounts.shard;
        shard.shard_x = shard_x;
        shard.shard_y = shard_y;
        shard.pixels = vec![0u8; BYTES_PER_SHARD];
        shard.creator = session.main_address;
        shard.bump = ctx.bumps.shard;
        
        msg!(
            "Shard ({}, {}) initialized with {} pixels ({} bytes packed)", 
            shard_x, shard_y, PIXELS_PER_SHARD, BYTES_PER_SHARD
        );
        
        emit!(ShardInitialized {
            shard_x,
            shard_y,
            creator: shard.creator,
            main_wallet: session.main_address,
            timestamp: Clock::get()?.unix_timestamp as u64,
        });
        Ok(())
    }

    /// Delegate an existing shard to Ephemeral Rollups
    /// This should be called after initialize_shard in a separate transaction
    pub fn delegate_shard(
        ctx: Context<DelegateShard>,
        shard_x: u16,
        shard_y: u16,
    ) -> Result<()> {
        // Delegate the shard to Ephemeral Rollups
        ctx.accounts.delegate_pda(
            &ctx.accounts.authority,
            &[SHARD_SEED, &shard_x.to_le_bytes(), &shard_y.to_le_bytes()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        
        msg!("Shard ({}, {}) delegated to ER", shard_x, shard_y);
        Ok(())
    }

    // ========================================
    // Pixel Placement
    // ========================================

    /// Place a pixel using global coordinates
    /// px, py: 0 to 524,287 (global pixel coordinates)
    /// color: 1-15 (0 is reserved for unset/transparent, 4-bit packing)
    pub fn place_pixel(
        ctx: Context<PlacePixel>,
        _shard_x: u16,  // Used in seeds validation
        _shard_y: u16,  // Used in seeds validation
        px: u32,
        py: u32,
        color: u8
    ) -> Result<()> {
        require!(px < CANVAS_RES && py < CANVAS_RES, PixelError::InvalidPixelCoord);
        require!(color > 0 && color <= AVAILABLE_COLORS, PixelError::InvalidColor);
        
        // Calculate expected shard coordinates
        let expected_shard_x = (px / SHARD_DIMENSION) as u16;
        let expected_shard_y = (py / SHARD_DIMENSION) as u16;
        
        // Verify the correct shard was passed
        let shard = &mut ctx.accounts.shard;
        require!(
            shard.shard_x == expected_shard_x && shard.shard_y == expected_shard_y,
            PixelError::ShardMismatch
        );

        let session = &mut ctx.accounts.session;

        if shard.creator != session.main_address {
             let clock = Clock::get()?;
             let now = clock.unix_timestamp as u64;

             if session.cooldown_counter >= COOLDOWN_LIMIT {
                 if now.saturating_sub(session.last_place_timestamp) >= COOLDOWN_PERIOD {
                     session.cooldown_counter = 0;
                 } else {
                     return err!(PixelError::Cooldown);
                 }
             }

             session.cooldown_counter = session.cooldown_counter.checked_add(1).unwrap();

             if session.cooldown_counter >= COOLDOWN_LIMIT {
                 session.last_place_timestamp = now;
             }
        }
        
        // Calculate local pixel position within the shard
        let local_x = px % SHARD_DIMENSION;
        let local_y = py % SHARD_DIMENSION;
        let local_pixel_id = (local_y * SHARD_DIMENSION + local_x) as usize;
        
        // 8-bit storage: 1 byte per pixel, direct indexing
        shard.pixels[local_pixel_id] = color;
        
        msg!(
            "Pixel ({}, {}) -> Shard ({}, {}) index {} = color {}",
            px, py,
            shard.shard_x, shard.shard_y,
            local_pixel_id,
            color
        );

        emit!(PixelChanged {
            px,
            py,
            color,
            painter: ctx.accounts.signer.key(),
            main_wallet: session.main_address,
            timestamp: Clock::get()?.unix_timestamp as u64,
        });

        Ok(())
    }

    /// Erase a pixel (set to 0/transparent)
    pub fn erase_pixel(
        ctx: Context<PlacePixel>,
        _shard_x: u16,
        _shard_y: u16,
        px: u32,
        py: u32,
    ) -> Result<()> {
        require!(px < CANVAS_RES && py < CANVAS_RES, PixelError::InvalidPixelCoord);
        
        let expected_shard_x = (px / SHARD_DIMENSION) as u16;
        let expected_shard_y = (py / SHARD_DIMENSION) as u16;
        
        let shard = &mut ctx.accounts.shard;
        require!(
            shard.shard_x == expected_shard_x && shard.shard_y == expected_shard_y,
            PixelError::ShardMismatch
        );
        
        let local_x = px % SHARD_DIMENSION;
        let local_y = py % SHARD_DIMENSION;
        let local_pixel_id = (local_y * SHARD_DIMENSION + local_x) as usize;
        
        // 8-bit storage: direct indexing, set to 0 (transparent)
        shard.pixels[local_pixel_id] = 0;
        
        msg!("Pixel ({}, {}) erased", px, py);

        // Context is PlacePixel, which includes session
        let session = &mut ctx.accounts.session;
        emit!(PixelChanged {
            px,
            py,
            color: 0, // 0 = erased/transparent
            painter: ctx.accounts.signer.key(),
            main_wallet: session.main_address,
            timestamp: Clock::get()?.unix_timestamp as u64,
        });

        Ok(())
    }

    // ========================================
    // MagicBlock Ephemeral Rollups Functions
    // ========================================

    /// Commit shard state from ER to base layer
    pub fn commit_shard(
        ctx: Context<CommitShardInput>, 
        _shard_x: u16, 
        _shard_y: u16
    ) -> Result<()> {
        commit_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.shard.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        msg!("Shard committed to base layer");
        Ok(())
    }
}

// ========================================
// Account Structs
// ========================================

/// Initialize a user session account (without delegation)
/// 
/// IMPORTANT: The transaction must include an Ed25519 verify instruction as the FIRST
/// instruction, verifying that main_wallet signed the authorization message.
#[derive(Accounts)]
#[instruction(main_wallet: Pubkey, signature: [u8; 64])]
pub struct InitializeUser<'info> {
    /// Session account PDA derived from the MAIN wallet (not session key)
    /// This ensures each main wallet has exactly one session account
    #[account(
        init,
        payer = authority,
        space = 8 + SessionAccount::INIT_SPACE,
        seeds = [b"session", authority.key().as_ref()],
        bump
    )]
    pub user: Account<'info, SessionAccount>,
    /// The session key that is authorized to act on behalf of main_wallet
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Instructions sysvar for Ed25519 signature verification
    #[account(address = instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

/// Delegate a user session account to Ephemeral Rollups
/// This should be called after initialize_user in a separate transaction
#[delegate]
#[derive(Accounts)]
pub struct DelegateUser<'info> {
    /// The session account to delegate
    #[account(
        mut,
        seeds = [b"session", authority.key().as_ref()],
        bump = user.bump,
    )]
    pub user: Account<'info, SessionAccount>,
    /// The session key authority
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: The PDA to delegate - same as user, used for delegation CPI
    #[account(mut, del, seeds = [b"session", authority.key().as_ref()], bump)]
    pub pda: AccountInfo<'info>,
}

/// Combined initialization and delegation accounts struct
/// This allows initializing a shard and delegating it to ER in a single transaction
/// Initialize a shard (without delegation)
/// Call delegate_shard separately after this to delegate to ER
#[derive(Accounts)]
#[instruction(shard_x: u16, shard_y: u16)]
pub struct InitializeShard<'info> {
    /// The shard account to initialize
    #[account(
        init,
        payer = authority,
        space = 8 + PixelShard::INIT_SPACE,
        seeds = [SHARD_SEED, &shard_x.to_le_bytes(), &shard_y.to_le_bytes()],
        bump
    )]
    pub shard: Account<'info, PixelShard>,

    /// CHECK: The session account, could be delegated. Verified by seeds and custom owner check.
    #[account(
        seeds = [b"session", authority.key().as_ref()],
        bump,
    )]
    pub session: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Delegate an existing shard to Ephemeral Rollups
/// This should be called after initialize_shard in a separate transaction
#[delegate]
#[derive(Accounts)]
#[instruction(shard_x: u16, shard_y: u16)]
pub struct DelegateShard<'info> {
    /// The authority requesting delegation
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: The shard PDA to delegate - validated by seeds constraint
    #[account(mut, del, seeds = [SHARD_SEED, &shard_x.to_le_bytes(), &shard_y.to_le_bytes()], bump)]
    pub pda: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(shard_x: u16, shard_y: u16)]
pub struct PlacePixel<'info> {
    #[account(
        mut,
        seeds = [SHARD_SEED, &shard_x.to_le_bytes(), &shard_y.to_le_bytes()],
        bump = shard.bump
    )]
    pub shard: Account<'info, PixelShard>,

    #[account(
        mut,
        seeds = [b"session", signer.key().as_ref()],
        bump = session.bump,
    )]
    pub session: Account<'info, SessionAccount>,

    #[account(mut)]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(shard_x: u16, shard_y: u16)]
pub struct GetPixel<'info> {
    #[account(
        seeds = [SHARD_SEED, &shard_x.to_le_bytes(), &shard_y.to_le_bytes()],
        bump = shard.bump
    )]
    pub shard: Account<'info, PixelShard>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(shard_x: u16, shard_y: u16)]
pub struct DelegateShardInput<'info> {
    pub payer: Signer<'info>,
    /// CHECK: The PDA to delegate - validated by seeds constraint
    #[account(mut, del, seeds = [SHARD_SEED, &shard_x.to_le_bytes(), &shard_y.to_le_bytes()], bump)]
    pub pda: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts)]
#[instruction(shard_x: u16, shard_y: u16)]
pub struct CommitShardInput<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [SHARD_SEED, &shard_x.to_le_bytes(), &shard_y.to_le_bytes()], bump = shard.bump)]
    pub shard: Account<'info, PixelShard>,
}

// ========================================
// Account Data
// ========================================

/// A single shard of the pixel canvas
/// Each shard stores 8,100 pixels (90×90 grid) using 8-bit colors = ~8KB
/// Up to 33,942,276 shards (5826×5826 grid) can cover the full 524,288×524,288 canvas
/// Shards are created on-demand when users paint in new regions
#[account]
#[derive(InitSpace)]
pub struct PixelShard {
    /// Shard X coordinate (0-5825)
    pub shard_x: u16,
    /// Shard Y coordinate (0-5825)
    pub shard_y: u16,
    /// Pixel data - 8-bit storage (1 byte per pixel)
    /// Index = local_y * 90 + local_x
    /// Value = color_index (0 = unset/transparent, 1-255 = palette colors)
    #[max_len(8100)]
    pub pixels: Vec<u8>,
    /// Creator of the shard (who paid for initialization)
    pub creator: Pubkey,
    /// PDA bump seed
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
// the session key will create this account and tell it which main wallet it belongs to
// must verify signature from the main account before creating session account
pub struct SessionAccount {
    pub main_address: Pubkey,
    pub authority: Pubkey,
    pub cooldown_counter: u8,
    pub last_place_timestamp: u64,
    pub bump: u8,
}

// ========================================
// Errors
// ========================================

#[error_code]
pub enum PixelError {
    #[msg("Invalid shard coordinates: must be 0-5825")]
    InvalidShardCoord,
    #[msg("Invalid pixel coordinates: must be 0-524287")]
    InvalidPixelCoord,
    #[msg("Shard coordinates don't match pixel location")]
    ShardMismatch,
    #[msg("Invalid color: must be 1-15 (4-bit)")]
    InvalidColor,
    #[msg("Invalid authentication")]
    InvalidAuth,
    #[msg("Cooldown active: limit reached")]
    Cooldown,
}

// ========================================
// Events
// ========================================

#[event]
pub struct PixelChanged {
    pub px: u32,
    pub py: u32,
    pub color: u8,
    pub painter: Pubkey,
    pub main_wallet: Pubkey,
    pub timestamp: u64,
}

#[event]
pub struct ShardInitialized {
    pub shard_x: u16,
    pub shard_y: u16,
    pub creator: Pubkey,
    pub main_wallet: Pubkey,
    pub timestamp: u64,
}