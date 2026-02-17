use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::JobCompleted;
use crate::state::{JobAccount, JobStatus, ProviderAccount};
use crate::utils::{bps_amount, calculate_reputation, transfer_lamports};

#[derive(Accounts)]
pub struct CompleteJob<'info> {
    #[account(
        mut,
        close = client,
        seeds = [b"job", job_account.client.as_ref(), &job_account.job_nonce.to_le_bytes()],
        bump = job_account.bump,
        constraint = job_account.status == JobStatus::Active @ EscrowError::InvalidJobStatus,
        constraint = job_account.client == client.key() @ EscrowError::UnauthorizedClient,
        constraint = job_account.freelancer != Pubkey::default() @ EscrowError::ProviderNotRegistered,
    )]
    pub job_account: Account<'info, JobAccount>,

    #[account(mut)]
    pub client: Signer<'info>,

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

pub fn handler(ctx: Context<CompleteJob>) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        clock.slot <= ctx.accounts.job_account.expiry_slot,
        EscrowError::JobExpired
    );

    let fee = bps_amount(
        ctx.accounts.job_account.amount,
        ctx.accounts.job_account.fee_bps_snapshot,
    )?;
    let payout = ctx
        .accounts
        .job_account
        .amount
        .checked_sub(fee)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;

    let provider_account = &mut ctx.accounts.provider_account;
    provider_account.total_jobs_completed = provider_account
        .total_jobs_completed
        .checked_add(1)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    provider_account.reputation_score = calculate_reputation(
        provider_account.total_jobs_completed,
        provider_account.total_jobs_disputed_lost,
        provider_account.total_staked,
    )?;

    let job_account = &mut ctx.accounts.job_account;
    job_account.status = JobStatus::Completed;

    let job_info = job_account.to_account_info();
    transfer_lamports(
        &job_info,
        &ctx.accounts.freelancer_wallet.to_account_info(),
        payout,
    )?;
    transfer_lamports(&job_info, &ctx.accounts.treasury.to_account_info(), fee)?;

    emit!(JobCompleted {
        pda: job_account.key(),
        client: ctx.accounts.client.key(),
        freelancer: ctx.accounts.freelancer_wallet.key(),
        payout,
        fee,
    });

    Ok(())
}
