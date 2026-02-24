use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::state::{ClientAccount, JobAccount, PlatformConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateMilestoneJobParams {
    pub milestone_amounts: Vec<u64>,
    pub expiry_slot: u64,
}

#[derive(Accounts)]
pub struct CreateMilestoneJob<'info> {
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

    pub system_program: Program<'info, System>,
}

pub fn handler(_ctx: Context<CreateMilestoneJob>, _params: CreateMilestoneJobParams) -> Result<()> {
    err!(EscrowError::TokenPaymentRequired)
}
