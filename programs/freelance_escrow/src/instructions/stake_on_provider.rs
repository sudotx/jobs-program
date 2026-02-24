use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::EscrowError;
use crate::events::StakeDeposited;
use crate::state::{PlatformConfig, ProviderAccount, StakingAccount};
use crate::utils::{calculate_reputation, mul_div_floor, SLASH_MULTIPLIER_SCALE};

#[derive(Accounts)]
pub struct StakeOnProvider<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"provider", provider_account.authority.as_ref()],
        bump = provider_account.bump,
    )]
    pub provider_account: Account<'info, ProviderAccount>,

    #[account(
        init_if_needed,
        payer = staker,
        space = 8 + StakingAccount::INIT_SPACE,
        seeds = [b"stake", staker.key().as_ref(), provider_account.authority.as_ref()],
        bump,
    )]
    pub staking_account: Account<'info, StakingAccount>,

    #[account(
        seeds = [b"platform", platform_config.admin.as_ref()],
        bump = platform_config.bump,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    pub staking_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = staker_token_account.owner == staker.key() @ EscrowError::InvalidTokenAccount,
        constraint = staker_token_account.mint == staking_mint.key() @ EscrowError::InvalidStakingTokenMint,
    )]
    pub staker_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = staker,
        seeds = [b"stake-vault", staking_account.key().as_ref()],
        bump,
        token::mint = staking_mint,
        token::authority = staking_account,
    )]
    pub staking_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<StakeOnProvider>, amount: u64) -> Result<()> {
    require!(
        !ctx.accounts.platform_config.paused,
        EscrowError::PlatformPaused
    );

    require!(amount > 0, EscrowError::InvalidAmount);
    require!(
        ctx.accounts.platform_config.staking_token_mint != Pubkey::default(),
        EscrowError::StakingTokenMintUnset
    );
    require_keys_eq!(
        ctx.accounts.staking_mint.key(),
        ctx.accounts.platform_config.staking_token_mint,
        EscrowError::InvalidStakingTokenMint
    );

    if ctx.accounts.provider_account.slash_multiplier == 0 {
        ctx.accounts.provider_account.slash_multiplier = SLASH_MULTIPLIER_SCALE;
    }
    let provider_authority = ctx.accounts.provider_account.authority;
    let slash_multiplier = ctx.accounts.provider_account.slash_multiplier;
    let stake_shares = mul_div_floor(amount, SLASH_MULTIPLIER_SCALE, slash_multiplier)?;

    let slot = Clock::get()?.slot;

    let is_new = {
        let staking_account = &mut ctx.accounts.staking_account;
        let is_new = staking_account.staker == Pubkey::default();

        if is_new {
            staking_account.staker = ctx.accounts.staker.key();
            staking_account.freelancer = provider_authority;
            staking_account.staking_mint = ctx.accounts.staking_mint.key();
            staking_account.token_vault = ctx.accounts.staking_vault.key();
            staking_account.amount = 0;
            staking_account.bump = ctx.bumps.staking_account;
        } else {
            require_keys_eq!(
                staking_account.staking_mint,
                ctx.accounts.staking_mint.key(),
                EscrowError::InvalidStakingTokenMint
            );
            require_keys_eq!(
                staking_account.token_vault,
                ctx.accounts.staking_vault.key(),
                EscrowError::InvalidTokenAccount
            );
        }
        is_new
    };

    if is_new {
        ctx.accounts.provider_account.staker_count = ctx
            .accounts
            .provider_account
            .staker_count
            .checked_add(1)
            .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    }

    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.staker_token_account.to_account_info(),
            to: ctx.accounts.staking_vault.to_account_info(),
            authority: ctx.accounts.staker.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, amount)?;

    {
        let staking_account = &mut ctx.accounts.staking_account;
        staking_account.amount = staking_account
            .amount
            .checked_add(stake_shares)
            .ok_or_else(|| error!(EscrowError::MathOverflow))?;
        staking_account.last_stake_slot = slot;
    }

    let provider_account = &mut ctx.accounts.provider_account;
    provider_account.total_staked = provider_account
        .total_staked
        .checked_add(amount)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    provider_account.reputation_score = calculate_reputation(
        provider_account.total_jobs_completed,
        provider_account.total_jobs_disputed_lost,
        provider_account.total_staked,
    )?;

    emit!(StakeDeposited {
        staker: ctx.accounts.staker.key(),
        freelancer: provider_account.authority,
        amount,
        total_staked: provider_account.total_staked,
    });

    Ok(())
}
