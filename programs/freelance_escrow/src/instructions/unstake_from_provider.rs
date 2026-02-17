use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::StakeWithdrawn;
use crate::state::{ProviderAccount, StakingAccount};
use crate::utils::{
    calculate_reputation, close_program_account, transfer_lamports, COOLDOWN_SLOTS,
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
}

pub fn handler(ctx: Context<UnstakeFromProvider>, amount: u64) -> Result<()> {
    require!(amount > 0, EscrowError::InvalidAmount);

    let slot = Clock::get()?.slot;
    let cooldown_end = ctx
        .accounts
        .staking_account
        .last_stake_slot
        .checked_add(COOLDOWN_SLOTS)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    require!(slot > cooldown_end, EscrowError::StakeCooldownActive);

    let staking_account = &mut ctx.accounts.staking_account;
    require!(
        amount <= staking_account.amount,
        EscrowError::InsufficientStake
    );

    staking_account.amount = staking_account
        .amount
        .checked_sub(amount)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;

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
    transfer_lamports(&staking_info, &staker_info, amount)?;

    let remaining = staking_account.amount;
    if remaining == 0 {
        provider_account.staker_count = provider_account
            .staker_count
            .checked_sub(1)
            .ok_or_else(|| error!(EscrowError::MathOverflow))?;
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
