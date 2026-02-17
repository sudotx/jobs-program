use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::PlatformInitialized;
use crate::state::PlatformConfig;
use crate::utils::MAX_FEE_BPS;

#[derive(Accounts)]
pub struct InitializePlatform<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + PlatformConfig::INIT_SPACE,
        seeds = [b"platform", admin.key().as_ref()],
        bump,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializePlatform>,
    fee_bps: u16,
    treasury: Pubkey,
    default_lien_timeout_slots: u64,
) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, EscrowError::InvalidFeeBps);
    require!(treasury != Pubkey::default(), EscrowError::InvalidTreasury);
    require!(default_lien_timeout_slots > 0, EscrowError::InvalidExpiry);

    let platform_config = &mut ctx.accounts.platform_config;
    platform_config.admin = ctx.accounts.admin.key();
    platform_config.fee_bps = fee_bps;
    platform_config.treasury = treasury;
    platform_config.arbiters = Vec::new();
    platform_config.default_lien_timeout_slots = default_lien_timeout_slots;
    platform_config.paused = false;
    platform_config.bump = ctx.bumps.platform_config;

    emit!(PlatformInitialized {
        admin: platform_config.admin,
        fee_bps: platform_config.fee_bps,
        treasury: platform_config.treasury,
    });

    Ok(())
}
