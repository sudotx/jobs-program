use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::LienForceResolved;
use crate::instructions::resolve_lien::{disburse_settlement, settle_lien};
use crate::state::{JobAccount, JobStatus, PlatformConfig, ProviderAccount};

#[derive(Accounts)]
pub struct ForceResolveLien<'info> {
    pub crank: Signer<'info>,

    #[account(
        mut,
        close = client_wallet,
        seeds = [b"job", job_account.client.as_ref(), &job_account.job_nonce.to_le_bytes()],
        bump = job_account.bump,
        constraint = job_account.status == JobStatus::LienActive @ EscrowError::InvalidJobStatus,
    )]
    pub job_account: Account<'info, JobAccount>,

    /// CHECK: validated against `job_account.client`
    #[account(
        mut,
        constraint = client_wallet.key() == job_account.client @ EscrowError::UnauthorizedClient,
    )]
    pub client_wallet: UncheckedAccount<'info>,

    /// CHECK: validated against `job_account.freelancer`
    #[account(
        mut,
        constraint = freelancer_wallet.key() == job_account.freelancer @ EscrowError::UnauthorizedFreelancer,
    )]
    pub freelancer_wallet: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"provider", job_account.freelancer.as_ref()],
        bump = provider_account.bump,
    )]
    pub provider_account: Account<'info, ProviderAccount>,

    #[account(
        seeds = [b"platform", platform_config.admin.as_ref()],
        bump = platform_config.bump,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    /// CHECK: validated against `job_account.treasury_snapshot`
    #[account(
        mut,
        constraint = treasury.key() == job_account.treasury_snapshot @ EscrowError::InvalidTreasury,
    )]
    pub treasury: UncheckedAccount<'info>,
}

pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, ForceResolveLien<'info>>) -> Result<()> {
    require!(
        !ctx.accounts.platform_config.paused,
        EscrowError::PlatformPaused
    );

    let slot = Clock::get()?.slot;
    require!(
        slot > ctx.accounts.job_account.lien_deadline_slot,
        EscrowError::LienNotExpired
    );

    let freelancer_share_bps = ctx
        .accounts
        .platform_config
        .force_resolution_freelancer_share_bps;
    let outcome = settle_lien(
        &mut ctx.accounts.job_account,
        &mut ctx.accounts.provider_account,
        &ctx.accounts.platform_config,
        freelancer_share_bps,
    )?;
    disburse_settlement(
        &ctx.accounts.job_account,
        &outcome,
        &ctx.accounts.client_wallet.to_account_info(),
        &ctx.accounts.freelancer_wallet.to_account_info(),
        &ctx.accounts.treasury.to_account_info(),
        ctx.remaining_accounts,
    )?;

    emit!(LienForceResolved {
        pda: ctx.accounts.job_account.key(),
        freelancer_share_bps,
        freelancer_payout: outcome.freelancer_payout,
        client_refund: outcome.client_refund,
        slash_bps_applied: outcome.slash_bps_applied,
        slash_amount: outcome.slash_amount,
    });

    Ok(())
}
