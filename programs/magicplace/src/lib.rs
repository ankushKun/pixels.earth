use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{commit_accounts};

declare_id!("CHhht9A6W95JYGm3AA1yH34n112uexmrpKqoSwKwfmxE");

// ========================================
// Canvas Configuration - 2^18 x 2^18 with dynamic sharding
// ========================================

/// Total canvas resolution per dimension (2^19 = 524,288)
const CANVAS_RES: u32 = 524288;

/// Each shard is 128x128 pixels
const SHARD_DIMENSION: u32 = 128;

/// Number of shards per dimension (524,288 / 128 = 4,096)
const SHARDS_PER_DIM: u32 = CANVAS_RES / SHARD_DIMENSION;

/// Total pixels stored in each shard (128 * 128 = 16,384)
const PIXELS_PER_SHARD: usize = (SHARD_DIMENSION * SHARD_DIMENSION) as usize;

/// Bytes needed to store packed pixels (2 pixels per byte using 4-bit colors)
const BYTES_PER_SHARD: usize = PIXELS_PER_SHARD / 2;

/// Seed prefix for shard PDAs
const SHARD_SEED: &[u8] = b"shard";

/// Available colors using 4-bit packing (0 = unset/transparent, 1-15 = palette colors)
const AVAILABLE_COLORS: u8 = 15;

#[ephemeral]
#[program]
pub mod magicplace {
    use super::*;

    // ========================================
    // Shard Management
    // ========================================

    /// Initialize a shard at (shard_x, shard_y) coordinates
    /// Shards are created on-demand when a user wants to paint in that region
    /// shard_x, shard_y: 0-4095 (4096 shards per dimension)
    pub fn initialize_shard(
        ctx: Context<InitializeShard>, 
        shard_x: u16, 
        shard_y: u16
    ) -> Result<()> {
        require!(
            (shard_x as u32) < SHARDS_PER_DIM && (shard_y as u32) < SHARDS_PER_DIM,
            PixelError::InvalidShardCoord
        );
        
        let shard = &mut ctx.accounts.shard;
        shard.shard_x = shard_x;
        shard.shard_y = shard_y;
        // Packed storage: 2 pixels per byte (4-bit colors)
        shard.pixels = vec![0u8; BYTES_PER_SHARD];
        shard.creator = ctx.accounts.authority.key();
        shard.bump = ctx.bumps.shard;
        
        msg!(
            "Shard ({}, {}) initialized with {} pixels ({} bytes packed)", 
            shard_x, shard_y, PIXELS_PER_SHARD, BYTES_PER_SHARD
        );
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
        
        // Calculate local pixel position within the shard
        let local_x = px % SHARD_DIMENSION;
        let local_y = py % SHARD_DIMENSION;
        let local_pixel_id = (local_y * SHARD_DIMENSION + local_x) as usize;
        
        // 4-bit packing: 2 pixels per byte
        // Even pixels (0, 2, 4...) in high nibble, odd pixels (1, 3, 5...) in low nibble
        let byte_index = local_pixel_id / 2;
        let is_high_nibble = local_pixel_id % 2 == 0;
        
        if is_high_nibble {
            // Clear high nibble and set new color
            shard.pixels[byte_index] = (shard.pixels[byte_index] & 0x0F) | (color << 4);
            // Clear low nibble and set new color
            shard.pixels[byte_index] = (shard.pixels[byte_index] & 0xF0) | (color & 0x0F);
        }
        
        msg!(
            "Pixel ({}, {}) -> Shard ({}, {}) byte {} nibble {} = color {}",
            px, py,
            shard.shard_x, shard.shard_y,
            byte_index,
            if is_high_nibble { "high" } else { "low" },
            color
        );

        emit!(PixelChanged {
            px,
            py,
            color,
            painter: ctx.accounts.signer.key(),
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
        
        // 4-bit packing: clear the appropriate nibble
        let byte_index = local_pixel_id / 2;
        let is_high_nibble = local_pixel_id % 2 == 0;
        
        if is_high_nibble {
            shard.pixels[byte_index] &= 0x0F; // Clear high nibble
        } else {
            shard.pixels[byte_index] &= 0xF0; // Clear low nibble
        }
        
        msg!("Pixel ({}, {}) erased", px, py);

        emit!(PixelChanged {
            px,
            py,
            color: 0, // 0 = erased/transparent
            painter: ctx.accounts.signer.key(),
            timestamp: Clock::get()?.unix_timestamp as u64,
        });

        Ok(())
    }

    // ========================================
    // MagicBlock Ephemeral Rollups Functions
    // ========================================

    /// Delegate a shard to Ephemeral Rollups for fast transactions
    pub fn delegate_shard(
        ctx: Context<DelegateShardInput>, 
        shard_x: u16, 
        shard_y: u16
    ) -> Result<()> {
        require!(
            (shard_x as u32) < SHARDS_PER_DIM && (shard_y as u32) < SHARDS_PER_DIM,
            PixelError::InvalidShardCoord
        );
        
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[SHARD_SEED, &shard_x.to_le_bytes(), &shard_y.to_le_bytes()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        
        msg!("Shard ({}, {}) delegated to ER", shard_x, shard_y);
        Ok(())
    }

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

#[derive(Accounts)]
#[instruction(shard_x: u16, shard_y: u16)]
pub struct InitializeShard<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + PixelShard::INIT_SPACE,
        seeds = [SHARD_SEED, &shard_x.to_le_bytes(), &shard_y.to_le_bytes()],
        bump
    )]
    pub shard: Account<'info, PixelShard>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
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
/// Each shard stores 16,384 pixels (128×128 grid) using 4-bit packed colors = ~8KB
/// Up to 16,777,216 shards (4096×4096 grid) can cover the full 524,288×524,288 canvas
/// Shards are created on-demand when users paint in new regions
#[account]
#[derive(InitSpace)]
pub struct PixelShard {
    /// Shard X coordinate (0-4095)
    pub shard_x: u16,
    /// Shard Y coordinate (0-4095)
    pub shard_y: u16,
    /// Pixel data - 4-bit packed storage (2 pixels per byte)
    /// Byte index = pixel_id / 2
    /// Even pixels in high nibble (bits 4-7), odd pixels in low nibble (bits 0-3)
    /// Value = color_index (0 = unset/transparent, 1-15 = palette colors)
    #[max_len(8192)]
    pub pixels: Vec<u8>,
    /// Creator of the shard (who paid for initialization)
    pub creator: Pubkey,
    /// PDA bump seed
    pub bump: u8,
}

// ========================================
// Errors
// ========================================

#[error_code]
pub enum PixelError {
    #[msg("Invalid shard coordinates: must be 0-4095")]
    InvalidShardCoord,
    #[msg("Invalid pixel coordinates: must be 0-524287")]
    InvalidPixelCoord,
    #[msg("Shard coordinates don't match pixel location")]
    ShardMismatch,
    #[msg("Invalid color: must be 1-15 (4-bit)")]
    InvalidColor,
    #[msg("Invalid authentication")]
    InvalidAuth,
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
    pub timestamp: u64,
}
