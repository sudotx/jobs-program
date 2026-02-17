use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::JobCancelled;
use crate::state::{JobAccount, JobStatus};
use crate::utils::transfer_lamports;

#[derive(Accounts)]
pub struct CancelJob<'info> {
    #[account(
        mut,
        close = client,
        seeds = [b"job", job_account.client.as_ref(), &job_account.job_nonce.to_le_bytes()],
        bump = job_account.bump,
        constraint = job_account.client == client.key() @ EscrowError::UnauthorizedClient,
    )]
    pub job_account: Account<'info, JobAccount>,

    #[account(mut)]
    pub client: Signer<'info>,
}

pub fn handler(ctx: Context<CancelJob>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let job_account = &mut ctx.accounts.job_account;

    match job_account.status {
        JobStatus::Open => {}
        JobStatus::Active => {
            require!(slot > job_account.expiry_slot, EscrowError::JobNotExpired);
        }
        JobStatus::LienActive => {
            return err!(EscrowError::CannotCancelDuringLien);
        }
        _ => {
            return err!(EscrowError::InvalidJobStatus);
        }
    }

    let refund_amount = job_account.amount;
    job_account.status = JobStatus::Cancelled;

    let job_info = job_account.to_account_info();
    transfer_lamports(
        &job_info,
        &ctx.accounts.client.to_account_info(),
        refund_amount,
    )?;

    emit!(JobCancelled {
        pda: job_account.key(),
        client: ctx.accounts.client.key(),
        refund_amount,
    });

    Ok(())
}
