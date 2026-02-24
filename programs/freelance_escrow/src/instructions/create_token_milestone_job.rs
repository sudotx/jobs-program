use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::EscrowError;
use crate::events::JobCreated;
use crate::state::{ClientAccount, JobAccount, JobStatus, PlatformConfig};
use crate::utils::{MAX_MILESTONES, MIN_EXPIRY_SLOTS};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateTokenMilestoneJobParams {
    pub milestone_amounts: Vec<u64>,
    pub expiry_slot: u64,
}

#[derive(Accounts)]
pub struct CreateTokenMilestoneJob<'info> {
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

    pub payment_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = client_token_account.owner == client.key() @ EscrowError::InvalidTokenAccount,
        constraint = client_token_account.mint == payment_mint.key() @ EscrowError::InvalidPaymentMint,
    )]
    pub client_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = client,
        seeds = [b"vault", job_account.key().as_ref()],
        bump,
        token::mint = payment_mint,
        token::authority = job_account,
    )]
    pub token_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateTokenMilestoneJob>,
    params: CreateTokenMilestoneJobParams,
) -> Result<()> {
    let platform_config = &ctx.accounts.platform_config;
    require!(!platform_config.paused, EscrowError::PlatformPaused);

    let milestone_count = params.milestone_amounts.len();
    require!(
        milestone_count >= 2 && milestone_count <= MAX_MILESTONES,
        EscrowError::InvalidMilestoneConfig
    );

    let total_amount = params
        .milestone_amounts
        .iter()
        .try_fold(0u64, |acc, amount| {
            require!(*amount > 0, EscrowError::InvalidMilestoneConfig);
            acc.checked_add(*amount)
                .ok_or_else(|| error!(EscrowError::MathOverflow))
        })?;

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
    let payment_mint = ctx.accounts.payment_mint.key();
    require!(
        payment_mint != platform_config.staking_token_mint,
        EscrowError::PaymentMintConflictsWithStakingMint
    );
    require!(
        platform_config
            .allowed_payment_mints
            .contains(&payment_mint),
        EscrowError::PaymentMintNotAllowed
    );
    let milestone_count_u8: u8 = milestone_count
        .try_into()
        .map_err(|_| error!(EscrowError::MathOverflow))?;
    let milestone_amounts = params.milestone_amounts;

    let job_account = &mut ctx.accounts.job_account;
    job_account.client = ctx.accounts.client.key();
    job_account.freelancer = Pubkey::default();
    job_account.amount = total_amount;
    job_account.total_amount = total_amount;
    job_account.status = JobStatus::Open;
    job_account.job_nonce = nonce;
    job_account.created_slot = clock.slot;
    job_account.expiry_slot = params.expiry_slot;
    job_account.milestone_amounts = milestone_amounts;
    job_account.next_milestone_index = 0;
    job_account.lien_initiator = Pubkey::default();
    job_account.lien_deadline_slot = 0;
    job_account.arbiter = Pubkey::default();
    job_account.fee_bps_snapshot = platform_config.fee_bps;
    job_account.treasury_snapshot = platform_config.treasury;
    job_account.payment_mint = payment_mint;
    job_account.token_vault = ctx.accounts.token_vault.key();
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
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.client_token_account.to_account_info(),
            to: ctx.accounts.token_vault.to_account_info(),
            authority: ctx.accounts.client.to_account_info(),
        },
    );
    token::transfer(cpi_context, total_amount)?;

    emit!(JobCreated {
        pda: ctx.accounts.job_account.key(),
        client: ctx.accounts.client.key(),
        amount: total_amount,
        nonce,
        expiry_slot: params.expiry_slot,
        milestone_count: milestone_count_u8,
        payment_mint,
        fee_bps_snapshot: platform_config.fee_bps,
    });

    Ok(())
}
