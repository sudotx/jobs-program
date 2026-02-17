use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::utils::constants::{COMPLETION_WEIGHT, DISPUTE_PENALTY, STAKE_DIVISOR};

pub fn calculate_reputation(
    total_completed: u64,
    total_disputed_lost: u64,
    total_staked: u64,
) -> Result<i64> {
    let completion_score = (total_completed as i64)
        .checked_mul(COMPLETION_WEIGHT)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;

    let dispute_score = (total_disputed_lost as i64)
        .checked_mul(DISPUTE_PENALTY)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;

    let stake_score = (total_staked / STAKE_DIVISOR) as i64;

    completion_score
        .checked_sub(dispute_score)
        .and_then(|v| v.checked_add(stake_score))
        .ok_or_else(|| error!(EscrowError::MathOverflow))
}

pub fn bps_amount(amount: u64, bps: u16) -> Result<u64> {
    amount
        .checked_mul(bps as u64)
        .and_then(|v| v.checked_div(10_000))
        .ok_or_else(|| error!(EscrowError::MathOverflow))
}

pub fn transfer_lamports(from: &AccountInfo<'_>, to: &AccountInfo<'_>, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let from_balance = from.lamports();
    let to_balance = to.lamports();

    let updated_from = from_balance
        .checked_sub(amount)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    let updated_to = to_balance
        .checked_add(amount)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;

    **from.try_borrow_mut_lamports()? = updated_from;
    **to.try_borrow_mut_lamports()? = updated_to;

    Ok(())
}

pub fn close_program_account(account: &AccountInfo<'_>, recipient: &AccountInfo<'_>) -> Result<()> {
    let remaining = account.lamports();
    let recipient_balance = recipient.lamports();
    let updated_recipient = recipient_balance
        .checked_add(remaining)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;

    **recipient.try_borrow_mut_lamports()? = updated_recipient;
    **account.try_borrow_mut_lamports()? = 0;

    account.assign(&anchor_lang::system_program::ID);
    account.resize(0)?;

    Ok(())
}
