use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::JobMilestoneCompleted;
use crate::state::{JobAccount, JobStatus, PlatformConfig, ProviderAccount};
use crate::utils::{
    bps_amount, calculate_reputation, close_program_account, close_vault, is_token_job,
    parse_complete_token_accounts, transfer_from_vault,
};

#[derive(Accounts)]
pub struct CompleteMilestone<'info> {
    #[account(
        mut,
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

pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, CompleteMilestone<'info>>) -> Result<()> {
    require!(
        !ctx.accounts.platform_config.paused,
        EscrowError::PlatformPaused
    );

    let clock = Clock::get()?;
    require!(
        clock.slot <= ctx.accounts.job_account.expiry_slot,
        EscrowError::JobExpired
    );

    let milestone_index = usize::from(ctx.accounts.job_account.next_milestone_index);
    require!(
        !ctx.accounts.job_account.milestone_amounts.is_empty(),
        EscrowError::NotMilestoneJob
    );
    require!(
        milestone_index < ctx.accounts.job_account.milestone_amounts.len(),
        EscrowError::InvalidJobStatus
    );

    let milestone_amount = ctx.accounts.job_account.milestone_amounts[milestone_index];
    let fee = bps_amount(milestone_amount, ctx.accounts.job_account.fee_bps_snapshot)?;
    let payout = milestone_amount
        .checked_sub(fee)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;

    let job_key = ctx.accounts.job_account.key();
    let job_client = ctx.accounts.job_account.client;
    let job_nonce = ctx.accounts.job_account.job_nonce;
    let job_bump = ctx.accounts.job_account.bump;
    let payment_mint = ctx.accounts.job_account.payment_mint;
    let token_vault = ctx.accounts.job_account.token_vault;
    require!(
        is_token_job(payment_mint),
        EscrowError::TokenPaymentRequired
    );

    let job_info = ctx.accounts.job_account.to_account_info();
    let token_accounts = parse_complete_token_accounts(
        ctx.remaining_accounts,
        payment_mint,
        token_vault,
        job_key,
        ctx.accounts.freelancer_wallet.key(),
        ctx.accounts.treasury.key(),
    )?;

    let nonce_bytes = job_nonce.to_le_bytes();
    let bump = [job_bump];
    let signer_seed_components: &[&[u8]] = &[b"job", job_client.as_ref(), &nonce_bytes, &bump];
    let signer_seeds: &[&[&[u8]]] = &[signer_seed_components];

    transfer_from_vault(
        token_accounts.token_program,
        token_accounts.token_vault,
        token_accounts.freelancer_token_account,
        &job_info,
        signer_seeds,
        payout,
    )?;
    transfer_from_vault(
        token_accounts.token_program,
        token_accounts.token_vault,
        token_accounts.treasury_token_account,
        &job_info,
        signer_seeds,
        fee,
    )?;

    let milestone_index_u8: u8 = milestone_index
        .try_into()
        .map_err(|_| error!(EscrowError::MathOverflow))?;
    let (remaining_amount, completed_all) = {
        let job_account = &mut ctx.accounts.job_account;
        job_account.amount = job_account
            .amount
            .checked_sub(milestone_amount)
            .ok_or_else(|| error!(EscrowError::MathOverflow))?;
        job_account.next_milestone_index = job_account
            .next_milestone_index
            .checked_add(1)
            .ok_or_else(|| error!(EscrowError::MathOverflow))?;

        let completed_all =
            usize::from(job_account.next_milestone_index) == job_account.milestone_amounts.len();
        if completed_all {
            job_account.status = JobStatus::Completed;
        }

        (job_account.amount, completed_all)
    };

    if completed_all {
        if ctx.accounts.job_account.total_amount
            >= ctx.accounts.platform_config.min_reputation_job_amount
        {
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
        }
    }

    emit!(JobMilestoneCompleted {
        pda: job_key,
        client: ctx.accounts.client.key(),
        freelancer: ctx.accounts.freelancer_wallet.key(),
        milestone_index: milestone_index_u8,
        milestone_amount,
        payout,
        fee,
        remaining_amount,
        completed_all,
    });

    if completed_all {
        let nonce_bytes = job_nonce.to_le_bytes();
        let bump = [job_bump];
        let signer_seed_components: &[&[u8]] = &[b"job", job_client.as_ref(), &nonce_bytes, &bump];
        let signer_seeds: &[&[&[u8]]] = &[signer_seed_components];

        close_vault(
            token_accounts.token_program,
            token_accounts.token_vault,
            &ctx.accounts.client.to_account_info(),
            &job_info,
            signer_seeds,
        )?;
        close_program_account(&job_info, &ctx.accounts.client.to_account_info())?;
    }

    Ok(())
}
