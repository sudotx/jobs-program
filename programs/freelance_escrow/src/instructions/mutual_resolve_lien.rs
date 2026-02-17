use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::LienResolved;
use crate::instructions::resolve_lien::{settle_lien, ResolveLienParams};
use crate::state::{JobAccount, JobStatus, ProviderAccount};

#[derive(Accounts)]
pub struct MutualResolveLien<'info> {
    #[account(
        mut,
        close = client,
        seeds = [b"job", job_account.client.as_ref(), &job_account.job_nonce.to_le_bytes()],
        bump = job_account.bump,
        constraint = job_account.status == JobStatus::LienActive @ EscrowError::InvalidJobStatus,
        constraint = job_account.client == client.key() @ EscrowError::UnauthorizedClient,
        constraint = job_account.freelancer == freelancer.key() @ EscrowError::UnauthorizedFreelancer,
    )]
    pub job_account: Account<'info, JobAccount>,

    #[account(mut)]
    pub client: Signer<'info>,

    #[account(mut)]
    pub freelancer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"provider", freelancer.key().as_ref()],
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

pub fn handler(ctx: Context<MutualResolveLien>, params: ResolveLienParams) -> Result<()> {
    let outcome = settle_lien(
        &mut ctx.accounts.job_account,
        &mut ctx.accounts.provider_account,
        params.freelancer_share_bps,
        &ctx.accounts.client.to_account_info(),
        &ctx.accounts.freelancer.to_account_info(),
        &ctx.accounts.treasury.to_account_info(),
    )?;

    emit!(LienResolved {
        pda: ctx.accounts.job_account.key(),
        arbiter: Pubkey::default(),
        freelancer_share_bps: params.freelancer_share_bps,
        freelancer_payout: outcome.freelancer_payout,
        client_refund: outcome.client_refund,
        fee: outcome.fee,
    });

    Ok(())
}
