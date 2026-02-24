use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::JobCancelled;
use crate::state::{JobAccount, JobStatus, PlatformConfig};
use crate::utils::{close_vault, is_token_job, parse_cancel_token_accounts, transfer_from_vault};

#[derive(Accounts)]
pub struct CancelJob<'info> {
    #[account(
        mut,
        close = client,
        seeds = [b"job", job_account.client.as_ref(), &job_account.job_nonce.to_le_bytes()],
        bump = job_account.bump,
        constraint = job_account.client == client.key() @ EscrowError::UnauthorizedClient,
    )]
    pub job_account: Account<'info, JobAccount>,

    #[account(mut)]
    pub client: Signer<'info>,

    #[account(
        seeds = [b"platform", platform_config.admin.as_ref()],
        bump = platform_config.bump,
    )]
    pub platform_config: Account<'info, PlatformConfig>,
}

pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, CancelJob<'info>>) -> Result<()> {
    require!(
        !ctx.accounts.platform_config.paused,
        EscrowError::PlatformPaused
    );

    let slot = Clock::get()?.slot;

    match ctx.accounts.job_account.status {
        JobStatus::Open => {}
        JobStatus::Active => {
            require!(
                slot > ctx.accounts.job_account.expiry_slot,
                EscrowError::JobNotExpired
            );
        }
        JobStatus::LienActive => {
            return err!(EscrowError::CannotCancelDuringLien);
        }
        _ => {
            return err!(EscrowError::InvalidJobStatus);
        }
    }

    let refund_amount = ctx.accounts.job_account.amount;
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
    ctx.accounts.job_account.status = JobStatus::Cancelled;

    let job_info = ctx.accounts.job_account.to_account_info();
    let token_accounts = parse_cancel_token_accounts(
        ctx.remaining_accounts,
        payment_mint,
        token_vault,
        job_key,
        ctx.accounts.client.key(),
    )?;

    let nonce_bytes = job_nonce.to_le_bytes();
    let bump = [job_bump];
    let signer_seed_components: &[&[u8]] = &[b"job", job_client.as_ref(), &nonce_bytes, &bump];
    let signer_seeds: &[&[&[u8]]] = &[signer_seed_components];

    transfer_from_vault(
        token_accounts.token_program,
        token_accounts.token_vault,
        token_accounts.client_token_account,
        &job_info,
        signer_seeds,
        refund_amount,
    )?;
    close_vault(
        token_accounts.token_program,
        token_accounts.token_vault,
        &ctx.accounts.client.to_account_info(),
        &job_info,
        signer_seeds,
    )?;

    emit!(JobCancelled {
        pda: job_key,
        client: ctx.accounts.client.key(),
        refund_amount,
    });

    Ok(())
}
