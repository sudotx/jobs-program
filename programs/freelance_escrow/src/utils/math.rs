use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::utils::constants::{
    COMPLETION_WEIGHT, DISPUTE_PENALTY, REPUTATION_BASE_CONFIDENCE_BPS,
    REPUTATION_CONFIDENCE_CAP_JOBS, STAKE_DIVISOR,
};

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

    let raw_score = completion_score
        .checked_sub(dispute_score)
        .and_then(|v| v.checked_add(stake_score))
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;

    let total_resolved_jobs = total_completed
        .checked_add(total_disputed_lost)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    let capped_jobs = total_resolved_jobs.min(REPUTATION_CONFIDENCE_CAP_JOBS);
    let variable_bps = capped_jobs
        .checked_mul((10_000u16 - REPUTATION_BASE_CONFIDENCE_BPS) as u64)
        .and_then(|v| v.checked_div(REPUTATION_CONFIDENCE_CAP_JOBS))
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    let confidence_bps = (REPUTATION_BASE_CONFIDENCE_BPS as u64)
        .checked_add(variable_bps)
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;

    let weighted = (raw_score as i128)
        .checked_mul(confidence_bps as i128)
        .and_then(|v| v.checked_div(10_000))
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    i64::try_from(weighted).map_err(|_| error!(EscrowError::MathOverflow))
}

pub fn bps_amount(amount: u64, bps: u16) -> Result<u64> {
    amount
        .checked_mul(bps as u64)
        .and_then(|v| v.checked_div(10_000))
        .ok_or_else(|| error!(EscrowError::MathOverflow))
}

pub fn mul_div_floor(amount: u64, numerator: u64, denominator: u64) -> Result<u64> {
    require!(denominator > 0, EscrowError::MathOverflow);
    let value = (amount as u128)
        .checked_mul(numerator as u128)
        .and_then(|v| v.checked_div(denominator as u128))
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    u64::try_from(value).map_err(|_| error!(EscrowError::MathOverflow))
}

pub fn mul_div_ceil(amount: u64, numerator: u64, denominator: u64) -> Result<u64> {
    require!(denominator > 0, EscrowError::MathOverflow);
    let value = (amount as u128)
        .checked_mul(numerator as u128)
        .and_then(|v| v.checked_add((denominator as u128).checked_sub(1)?))
        .and_then(|v| v.checked_div(denominator as u128))
        .ok_or_else(|| error!(EscrowError::MathOverflow))?;
    u64::try_from(value).map_err(|_| error!(EscrowError::MathOverflow))
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
