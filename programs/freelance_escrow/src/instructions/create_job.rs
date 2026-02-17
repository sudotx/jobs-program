use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::errors::EscrowError;
use crate::events::JobCreated;
use crate::state::{ClientAccount, JobAccount, JobStatus, PlatformConfig};
use crate::utils::MIN_EXPIRY_SLOTS;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateJobParams {
    pub amount: u64,
    pub expiry_slot: u64,
}

#[derive(Accounts)]
pub struct CreateJob<'info> {
    #[account(mut)]
    pub client: Signer<'info>,

    #[account(
        mut,
        seeds = [b"platform", platform_config.admin.as_ref()],
        bump = platform_config.bump,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    #[account(
        init_if_needed,
        payer = client,
        space = 8 + ClientAccount::INIT_SPACE,
        seeds = [b"client", client.key().as_ref()],
        bump,
    )]
    pub client_account: Account<'info, ClientAccount>,

    #[account(
        init,
        payer = client,
        space = 8 + JobAccount::INIT_SPACE,
        seeds = [b"job", client.key().as_ref(), &client_account.job_nonce.to_le_bytes()],
        bump,
    )]
    pub job_account: Account<'info, JobAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateJob>, params: CreateJobParams) -> Result<()> {
    require!(params.amount > 0, EscrowError::InvalidAmount);

    let platform_config = &ctx.accounts.platform_config;
    require!(!platform_config.paused, EscrowError::PlatformPaused);

    let clock = Clock::get()?;
    let expiry_delta = params
        .expiry_slot
        .checked_sub(clock.slot)
        .ok_or_else(|| error!(EscrowError::InvalidExpiry))?;
    require!(expiry_delta >= MIN_EXPIRY_SLOTS, EscrowError::InvalidExpiry);

    let client_account = &mut ctx.accounts.client_account;
    if client_account.authority == Pubkey::default() {
        client_account.authority = ctx.accounts.client.key();
        client_account.job_nonce = 0;
        client_account.total_jobs_created = 0;
        client_account.bump = ctx.bumps.client_account;
    } else {
        require!(
            client_account.authority == ctx.accounts.client.key(),
            EscrowError::UnauthorizedClient
        );
    }

    let nonce = client_account.job_nonce;

    let job_account = &mut ctx.accounts.job_account;
    job_account.client = ctx.accounts.client.key();
    job_account.freelancer = Pubkey::default();
    job_account.amount = params.amount;
    job_account.status = JobStatus::Open;
    job_account.job_nonce = nonce;
    job_account.created_slot = clock.slot;
    job_account.expiry_slot = params.expiry_slot;
    job_account.lien_initiator = Pubkey::default();
    job_account.lien_deadline_slot = 0;
    job_account.arbiter = Pubkey::default();
    job_account.fee_bps_snapshot = platform_config.fee_bps;
    job_account.treasury_snapshot = platform_config.treasury;
    job_account.bump = ctx.bumps.job_account;

    client_account.job_nonce = client_account
        .job_nonce
        .checked_add(1)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    client_account.total_jobs_created = client_account
        .total_jobs_created
        .checked_add(1)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;

    let cpi_context = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.client.to_account_info(),
            to: ctx.accounts.job_account.to_account_info(),
        },
    );
    system_program::transfer(cpi_context, params.amount)?;

    emit!(JobCreated {
        pda: ctx.accounts.job_account.key(),
        client: ctx.accounts.client.key(),
        amount: params.amount,
        nonce,
        expiry_slot: params.expiry_slot,
        fee_bps_snapshot: platform_config.fee_bps,
    });

    Ok(())
}
