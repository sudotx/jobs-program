use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::JobAccepted;
use crate::state::{JobAccount, JobStatus, PlatformConfig, ProviderAccount};

#[derive(Accounts)]
pub struct AcceptJob<'info> {
    #[account(mut)]
    pub freelancer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"job", job_account.client.as_ref(), &job_account.job_nonce.to_le_bytes()],
        bump = job_account.bump,
        constraint = job_account.status == JobStatus::Open @ EscrowError::InvalidJobStatus,
        constraint = job_account.freelancer == Pubkey::default() @ EscrowError::JobAlreadyAssigned,
    )]
    pub job_account: Account<'info, JobAccount>,

    #[account(
        seeds = [b"provider", freelancer.key().as_ref()],
        bump = provider_account.bump,
    )]
    pub provider_account: Account<'info, ProviderAccount>,

    #[account(
        seeds = [b"platform", platform_config.admin.as_ref()],
        bump = platform_config.bump,
    )]
    pub platform_config: Account<'info, PlatformConfig>,
}

pub fn handler(ctx: Context<AcceptJob>) -> Result<()> {
    require!(
        !ctx.accounts.platform_config.paused,
        EscrowError::PlatformPaused
    );
    require!(
        ctx.accounts.freelancer.key() != ctx.accounts.job_account.client,
        EscrowError::SelfAcceptNotAllowed
    );

    let clock = Clock::get()?;
    require!(
        clock.slot < ctx.accounts.job_account.expiry_slot,
        EscrowError::JobExpired
    );

    let provider_account = &ctx.accounts.provider_account;
    require!(
        provider_account.total_staked >= ctx.accounts.platform_config.min_provider_stake_for_accept,
        EscrowError::InsufficientStakeForJobAcceptance
    );
    let provider_age_slots = clock
        .slot
        .checked_sub(provider_account.created_slot)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    require!(
        provider_age_slots
            >= ctx
                .accounts
                .platform_config
                .min_provider_age_slots_for_accept,
        EscrowError::ProviderTooNewForJobAcceptance
    );

    let job_account = &mut ctx.accounts.job_account;
    job_account.freelancer = ctx.accounts.freelancer.key();
    job_account.status = JobStatus::Active;

    emit!(JobAccepted {
        pda: job_account.key(),
        freelancer: ctx.accounts.freelancer.key(),
    });

    Ok(())
}
