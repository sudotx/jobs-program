use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::ProviderRegistered;
use crate::state::{PlatformConfig, ProviderAccount};
use crate::utils::SLASH_MULTIPLIER_SCALE;

#[derive(Accounts)]
pub struct RegisterProvider<'info> {
    #[account(mut)]
    pub freelancer: Signer<'info>,

    #[account(
        init,
        payer = freelancer,
        space = 8 + ProviderAccount::INIT_SPACE,
        seeds = [b"provider", freelancer.key().as_ref()],
        bump,
    )]
    pub provider_account: Account<'info, ProviderAccount>,

    #[account(
        seeds = [b"platform", platform_config.admin.as_ref()],
        bump = platform_config.bump,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterProvider>) -> Result<()> {
    require!(
        !ctx.accounts.platform_config.paused,
        EscrowError::PlatformPaused
    );

    let clock = Clock::get()?;
    let provider_account = &mut ctx.accounts.provider_account;
    provider_account.authority = ctx.accounts.freelancer.key();
    provider_account.total_jobs_completed = 0;
    provider_account.total_jobs_disputed_lost = 0;
    provider_account.reputation_score = 0;
    provider_account.total_staked = 0;
    provider_account.slash_multiplier = SLASH_MULTIPLIER_SCALE;
    provider_account.staker_count = 0;
    provider_account.created_slot = clock.slot;
    provider_account.created_at = clock.unix_timestamp;
    provider_account.bump = ctx.bumps.provider_account;

    emit!(ProviderRegistered {
        provider: provider_account.authority,
    });

    Ok(())
}
