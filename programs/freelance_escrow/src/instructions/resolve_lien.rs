use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::LienResolved;
use crate::state::{JobAccount, JobStatus, ProviderAccount};
use crate::utils::{bps_amount, calculate_reputation, transfer_lamports, MAX_SHARE_BPS};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ResolveLienParams {
    pub freelancer_share_bps: u16,
}

pub struct SettlementOutcome {
    pub freelancer_payout: u64,
    pub client_refund: u64,
    pub fee: u64,
}

#[derive(Accounts)]
pub struct ResolveLien<'info> {
    #[account(
        mut,
        close = client_wallet,
        seeds = [b"job", job_account.client.as_ref(), &job_account.job_nonce.to_le_bytes()],
        bump = job_account.bump,
        constraint = job_account.status == JobStatus::LienActive @ EscrowError::InvalidJobStatus,
    )]
    pub job_account: Account<'info, JobAccount>,

    pub arbiter: Signer<'info>,

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

    /// CHECK: validated against `job_account.treasury_snapshot`
    #[account(
        mut,
        constraint = treasury.key() == job_account.treasury_snapshot @ EscrowError::InvalidTreasury,
    )]
    pub treasury: UncheckedAccount<'info>,
}

pub fn settle_lien(
    job_account: &mut Account<JobAccount>,
    provider_account: &mut Account<ProviderAccount>,
    freelancer_share_bps: u16,
    client_wallet: &AccountInfo<'_>,
    freelancer_wallet: &AccountInfo<'_>,
    treasury: &AccountInfo<'_>,
) -> Result<SettlementOutcome> {
    require!(
        freelancer_share_bps <= MAX_SHARE_BPS,
        EscrowError::InvalidShareBps
    );

    let freelancer_gross = bps_amount(job_account.amount, freelancer_share_bps)?;
    let client_refund = job_account
        .amount
        .checked_sub(freelancer_gross)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;

    let fee = if freelancer_gross == 0 {
        0
    } else {
        bps_amount(freelancer_gross, job_account.fee_bps_snapshot)?
    };
    let freelancer_payout = freelancer_gross
        .checked_sub(fee)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;

    if freelancer_share_bps < 5_000 {
        provider_account.total_jobs_disputed_lost = provider_account
            .total_jobs_disputed_lost
            .checked_add(1)
            .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    }

    provider_account.reputation_score = calculate_reputation(
        provider_account.total_jobs_completed,
        provider_account.total_jobs_disputed_lost,
        provider_account.total_staked,
    )?;

    job_account.status = JobStatus::Resolved;

    let job_info = job_account.to_account_info();
    transfer_lamports(&job_info, client_wallet, client_refund)?;
    transfer_lamports(&job_info, freelancer_wallet, freelancer_payout)?;
    transfer_lamports(&job_info, treasury, fee)?;

    Ok(SettlementOutcome {
        freelancer_payout,
        client_refund,
        fee,
    })
}

pub fn handler(ctx: Context<ResolveLien>, params: ResolveLienParams) -> Result<()> {
    require!(
        ctx.accounts.arbiter.key() == ctx.accounts.job_account.arbiter,
        EscrowError::UnauthorizedArbiter
    );

    let outcome = settle_lien(
        &mut ctx.accounts.job_account,
        &mut ctx.accounts.provider_account,
        params.freelancer_share_bps,
        &ctx.accounts.client_wallet.to_account_info(),
        &ctx.accounts.freelancer_wallet.to_account_info(),
        &ctx.accounts.treasury.to_account_info(),
    )?;

    emit!(LienResolved {
        pda: ctx.accounts.job_account.key(),
        arbiter: ctx.accounts.arbiter.key(),
        freelancer_share_bps: params.freelancer_share_bps,
        freelancer_payout: outcome.freelancer_payout,
        client_refund: outcome.client_refund,
        fee: outcome.fee,
    });

    Ok(())
}
