use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::errors::EscrowError;
use crate::events::StakeDeposited;
use crate::state::{ProviderAccount, StakingAccount};
use crate::utils::calculate_reputation;

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

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<StakeOnProvider>, amount: u64) -> Result<()> {
    require!(amount > 0, EscrowError::InvalidAmount);

    let slot = Clock::get()?.slot;

    let staking_account = &mut ctx.accounts.staking_account;
    let is_new = staking_account.staker == Pubkey::default();

    if is_new {
        staking_account.staker = ctx.accounts.staker.key();
        staking_account.freelancer = ctx.accounts.provider_account.authority;
        staking_account.amount = 0;
        staking_account.bump = ctx.bumps.staking_account;

        ctx.accounts.provider_account.staker_count = ctx
            .accounts
            .provider_account
            .staker_count
            .checked_add(1)
            .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    }

    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.staker.to_account_info(),
            to: staking_account.to_account_info(),
        },
    );
    system_program::transfer(cpi_ctx, amount)?;

    staking_account.amount = staking_account
        .amount
        .checked_add(amount)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    staking_account.last_stake_slot = slot;

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
