use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

use crate::errors::EscrowError;
use crate::events::StakeWithdrawn;
use crate::state::{PlatformConfig, ProviderAccount, StakingAccount};
use crate::utils::{
    calculate_reputation, close_program_account, mul_div_ceil, mul_div_floor, COOLDOWN_SLOTS,
    SLASH_MULTIPLIER_SCALE,
};

#[derive(Accounts)]
pub struct UnstakeFromProvider<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stake", staker.key().as_ref(), staking_account.freelancer.as_ref()],
        bump = staking_account.bump,
        constraint = staking_account.staker == staker.key() @ EscrowError::UnauthorizedClient,
    )]
    pub staking_account: Account<'info, StakingAccount>,

    #[account(
        mut,
        seeds = [b"provider", staking_account.freelancer.as_ref()],
        bump = provider_account.bump,
    )]
    pub provider_account: Account<'info, ProviderAccount>,

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
        mut,
        constraint = staking_vault.key() == staking_account.token_vault @ EscrowError::InvalidTokenAccount,
        constraint = staking_vault.mint == staking_account.staking_mint @ EscrowError::InvalidStakingTokenMint,
        constraint = staking_vault.owner == staking_account.key() @ EscrowError::InvalidTokenAccount,
    )]
    pub staking_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = slash_recipient_token_account.owner == platform_config.treasury @ EscrowError::InvalidTokenAccount,
        constraint = slash_recipient_token_account.mint == staking_mint.key() @ EscrowError::InvalidStakingTokenMint,
    )]
    pub slash_recipient_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<UnstakeFromProvider>, amount: u64) -> Result<()> {
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
    require_keys_eq!(
        ctx.accounts.staking_account.staking_mint,
        ctx.accounts.staking_mint.key(),
        EscrowError::InvalidStakingTokenMint
    );

    if ctx.accounts.provider_account.slash_multiplier == 0 {
        ctx.accounts.provider_account.slash_multiplier = SLASH_MULTIPLIER_SCALE;
    }
    let slash_multiplier = ctx.accounts.provider_account.slash_multiplier;

    let slot = Clock::get()?.slot;
    let cooldown_end = ctx
        .accounts
        .staking_account
        .last_stake_slot
        .checked_add(COOLDOWN_SLOTS)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    require!(slot > cooldown_end, EscrowError::StakeCooldownActive);

    let staking_account = &mut ctx.accounts.staking_account;
    let withdrawable = mul_div_floor(
        staking_account.amount,
        slash_multiplier,
        SLASH_MULTIPLIER_SCALE,
    )?;
    require!(amount <= withdrawable, EscrowError::InsufficientStake);
    let shares_to_burn = mul_div_ceil(amount, SLASH_MULTIPLIER_SCALE, slash_multiplier)?;
    require!(
        shares_to_burn <= staking_account.amount,
        EscrowError::InsufficientStake
    );

    staking_account.amount = staking_account
        .amount
        .checked_sub(shares_to_burn)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    let remaining = mul_div_floor(
        staking_account.amount,
        slash_multiplier,
        SLASH_MULTIPLIER_SCALE,
    )?;

    let provider_account = &mut ctx.accounts.provider_account;
    provider_account.total_staked = provider_account
        .total_staked
        .checked_sub(amount)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    provider_account.reputation_score = calculate_reputation(
        provider_account.total_jobs_completed,
        provider_account.total_jobs_disputed_lost,
        provider_account.total_staked,
    )?;

    let staking_info = staking_account.to_account_info();
    let staker_info = ctx.accounts.staker.to_account_info();

    let bump = [staking_account.bump];
    let signer_seed_components: &[&[u8]] = &[
        b"stake",
        staking_account.staker.as_ref(),
        staking_account.freelancer.as_ref(),
        &bump,
    ];
    let signer_seeds: &[&[&[u8]]] = &[signer_seed_components];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.staking_vault.to_account_info(),
            to: ctx.accounts.staker_token_account.to_account_info(),
            authority: staking_info.clone(),
        },
        signer_seeds,
    );
    token::transfer(transfer_ctx, amount)?;

    let remaining_shares = staking_account.amount;
    if remaining_shares == 0 {
        ctx.accounts.staking_vault.reload()?;
        let slash_residual = ctx.accounts.staking_vault.amount;
        if slash_residual > 0 {
            let slash_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.staking_vault.to_account_info(),
                    to: ctx.accounts.slash_recipient_token_account.to_account_info(),
                    authority: staking_info.clone(),
                },
                signer_seeds,
            );
            token::transfer(slash_ctx, slash_residual)?;
        }

        provider_account.staker_count = provider_account
            .staker_count
            .checked_sub(1)
            .ok_or_else(|| error!(EscrowError::MathOverflow))?;

        let close_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.staking_vault.to_account_info(),
                destination: staker_info.clone(),
                authority: staking_info.clone(),
            },
            signer_seeds,
        );
        token::close_account(close_ctx)?;
        close_program_account(&staking_info, &staker_info)?;
    }

    emit!(StakeWithdrawn {
        staker: ctx.accounts.staker.key(),
        freelancer: provider_account.authority,
        amount,
        remaining,
    });

    Ok(())
}
