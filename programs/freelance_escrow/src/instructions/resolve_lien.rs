use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::LienResolved;
use crate::state::{JobAccount, JobStatus, PlatformConfig, ProviderAccount};
use crate::utils::{
    bps_amount, calculate_reputation, close_vault, is_token_job, parse_lien_token_accounts,
    transfer_from_vault, DISPUTE_LOSS_THRESHOLD_BPS, MAX_SHARE_BPS, SLASH_MULTIPLIER_SCALE,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ResolveLienParams {
    pub freelancer_share_bps: u16,
}

pub struct SettlementOutcome {
    pub freelancer_payout: u64,
    pub client_refund: u64,
    pub fee: u64,
    pub slash_bps_applied: u16,
    pub slash_amount: u64,
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

pub fn settle_lien(
    job_account: &mut Account<JobAccount>,
    provider_account: &mut Account<ProviderAccount>,
    platform_config: &Account<PlatformConfig>,
    freelancer_share_bps: u16,
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

    if provider_account.slash_multiplier == 0 {
        provider_account.slash_multiplier = SLASH_MULTIPLIER_SCALE;
    }

    let mut slash_bps_applied = 0;
    let mut slash_amount = 0;
    let reputation_eligible = job_account.total_amount >= platform_config.min_reputation_job_amount;

    if reputation_eligible && freelancer_share_bps < DISPUTE_LOSS_THRESHOLD_BPS {
        provider_account.total_jobs_disputed_lost = provider_account
            .total_jobs_disputed_lost
            .checked_add(1)
            .ok_or_else(|| error!(EscrowError::MathOverflow))?;

        if platform_config.dispute_slashing_enabled
            && platform_config.dispute_slash_bps > 0
            && provider_account.total_staked > 0
        {
            slash_bps_applied = platform_config.dispute_slash_bps;
            slash_amount = bps_amount(provider_account.total_staked, slash_bps_applied)?;
            if slash_amount > 0 {
                provider_account.total_staked = provider_account
                    .total_staked
                    .checked_sub(slash_amount)
                    .ok_or_else(|| error!(EscrowError::MathOverflow))?;

                let remaining_bps = (MAX_SHARE_BPS as u64)
                    .checked_sub(slash_bps_applied as u64)
                    .ok_or_else(|| error!(EscrowError::MathOverflow))?;
                let updated_multiplier = (provider_account.slash_multiplier as u128)
                    .checked_mul(remaining_bps as u128)
                    .and_then(|v| v.checked_div(MAX_SHARE_BPS as u128))
                    .ok_or_else(|| error!(EscrowError::MathOverflow))?;
                provider_account.slash_multiplier = u64::try_from(updated_multiplier)
                    .map_err(|_| error!(EscrowError::MathOverflow))?
                    .max(1);
            } else {
                slash_bps_applied = 0;
            }
        }
    }

    provider_account.reputation_score = calculate_reputation(
        provider_account.total_jobs_completed,
        provider_account.total_jobs_disputed_lost,
        provider_account.total_staked,
    )?;

    job_account.status = JobStatus::Resolved;
    job_account.amount = 0;

    Ok(SettlementOutcome {
        freelancer_payout,
        client_refund,
        fee,
        slash_bps_applied,
        slash_amount,
    })
}

pub fn disburse_settlement<'info>(
    job_account: &Account<'info, JobAccount>,
    outcome: &SettlementOutcome,
    client_wallet: &AccountInfo<'info>,
    freelancer_wallet: &AccountInfo<'info>,
    treasury: &AccountInfo<'info>,
    remaining_accounts: &[AccountInfo<'info>],
) -> Result<()> {
    let job_info = job_account.to_account_info();
    require!(
        is_token_job(job_account.payment_mint),
        EscrowError::TokenPaymentRequired
    );
    let token_accounts = parse_lien_token_accounts(
        remaining_accounts,
        job_account.payment_mint,
        job_account.token_vault,
        job_account.key(),
        client_wallet.key(),
        freelancer_wallet.key(),
        treasury.key(),
    )?;

    let nonce_bytes = job_account.job_nonce.to_le_bytes();
    let bump = [job_account.bump];
    let signer_seed_components: &[&[u8]] =
        &[b"job", job_account.client.as_ref(), &nonce_bytes, &bump];
    let signer_seeds: &[&[&[u8]]] = &[signer_seed_components];

    transfer_from_vault(
        token_accounts.token_program,
        token_accounts.token_vault,
        token_accounts.client_token_account,
        &job_info,
        signer_seeds,
        outcome.client_refund,
    )?;
    transfer_from_vault(
        token_accounts.token_program,
        token_accounts.token_vault,
        token_accounts.freelancer_token_account,
        &job_info,
        signer_seeds,
        outcome.freelancer_payout,
    )?;
    transfer_from_vault(
        token_accounts.token_program,
        token_accounts.token_vault,
        token_accounts.treasury_token_account,
        &job_info,
        signer_seeds,
        outcome.fee,
    )?;
    close_vault(
        token_accounts.token_program,
        token_accounts.token_vault,
        client_wallet,
        &job_info,
        signer_seeds,
    )?;

    Ok(())
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, ResolveLien<'info>>,
    params: ResolveLienParams,
) -> Result<()> {
    require!(
        !ctx.accounts.platform_config.paused,
        EscrowError::PlatformPaused
    );

    require!(
        ctx.accounts.arbiter.key() == ctx.accounts.job_account.arbiter,
        EscrowError::UnauthorizedArbiter
    );

    let outcome = settle_lien(
        &mut ctx.accounts.job_account,
        &mut ctx.accounts.provider_account,
        &ctx.accounts.platform_config,
        params.freelancer_share_bps,
    )?;
    disburse_settlement(
        &ctx.accounts.job_account,
        &outcome,
        &ctx.accounts.client_wallet.to_account_info(),
        &ctx.accounts.freelancer_wallet.to_account_info(),
        &ctx.accounts.treasury.to_account_info(),
        ctx.remaining_accounts,
    )?;

    emit!(LienResolved {
        pda: ctx.accounts.job_account.key(),
        arbiter: ctx.accounts.arbiter.key(),
        freelancer_share_bps: params.freelancer_share_bps,
        freelancer_payout: outcome.freelancer_payout,
        client_refund: outcome.client_refund,
        fee: outcome.fee,
        slash_bps_applied: outcome.slash_bps_applied,
        slash_amount: outcome.slash_amount,
    });

    Ok(())
}
