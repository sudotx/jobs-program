use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ClientAccount {
    pub authority: Pubkey,
    pub job_nonce: u64,
    pub total_jobs_created: u64,
    pub bump: u8,
}
