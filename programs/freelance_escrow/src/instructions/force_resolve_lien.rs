use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::LienForceResolved;
use crate::instructions::resolve_lien::settle_lien;
use crate::state::{JobAccount, JobStatus, ProviderAccount};

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

    /// CHECK: validated against `job_account.treasury_snapshot`
    #[account(
        mut,
        constraint = treasury.key() == job_account.treasury_snapshot @ EscrowError::InvalidTreasury,
    )]
    pub treasury: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<ForceResolveLien>) -> Result<()> {
    let slot = Clock::get()?.slot;
    require!(
        slot > ctx.accounts.job_account.lien_deadline_slot,
        EscrowError::LienNotExpired
    );

    let freelancer_share_bps: u16 = 5_000;
    let outcome = settle_lien(
        &mut ctx.accounts.job_account,
        &mut ctx.accounts.provider_account,
        freelancer_share_bps,
        &ctx.accounts.client_wallet.to_account_info(),
        &ctx.accounts.freelancer_wallet.to_account_info(),
        &ctx.accounts.treasury.to_account_info(),
    )?;

    emit!(LienForceResolved {
        pda: ctx.accounts.job_account.key(),
        freelancer_share_bps,
        freelancer_payout: outcome.freelancer_payout,
        client_refund: outcome.client_refund,
    });

    Ok(())
}
