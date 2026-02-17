use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::LienInitiated;
use crate::state::{JobAccount, JobStatus, PlatformConfig};

#[derive(Accounts)]
pub struct InitiateLien<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"job", job_account.client.as_ref(), &job_account.job_nonce.to_le_bytes()],
        bump = job_account.bump,
        constraint = job_account.status == JobStatus::Active @ EscrowError::InvalidJobStatus,
        constraint = job_account.freelancer != Pubkey::default() @ EscrowError::ProviderNotRegistered,
    )]
    pub job_account: Account<'info, JobAccount>,

    #[account(
        seeds = [b"platform", platform_config.admin.as_ref()],
        bump = platform_config.bump,
    )]
    pub platform_config: Account<'info, PlatformConfig>,
}

pub fn handler(ctx: Context<InitiateLien>) -> Result<()> {
    let signer = ctx.accounts.signer.key();
    let job_account = &mut ctx.accounts.job_account;

    require!(
        signer == job_account.client || signer == job_account.freelancer,
        EscrowError::UnauthorizedLienInitiator
    );

    let arbiters = &ctx.accounts.platform_config.arbiters;
    require!(!arbiters.is_empty(), EscrowError::NoArbitersAvailable);

    let index = (job_account.job_nonce as usize) % arbiters.len();
    let arbiter = arbiters[index];

    let clock = Clock::get()?;
    let deadline_slot = clock
        .slot
        .checked_add(ctx.accounts.platform_config.default_lien_timeout_slots)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;

    job_account.status = JobStatus::LienActive;
    job_account.lien_initiator = signer;
    job_account.arbiter = arbiter;
    job_account.lien_deadline_slot = deadline_slot;

    emit!(LienInitiated {
        pda: job_account.key(),
        initiator: signer,
        arbiter,
        deadline_slot,
    });

    Ok(())
}
