use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::JobAccepted;
use crate::state::{JobAccount, JobStatus, ProviderAccount};

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
}

pub fn handler(ctx: Context<AcceptJob>) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        clock.slot < ctx.accounts.job_account.expiry_slot,
        EscrowError::JobExpired
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
