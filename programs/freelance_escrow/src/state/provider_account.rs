use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ProviderAccount {
    pub authority: Pubkey,
    pub total_jobs_completed: u64,
    pub total_jobs_disputed_lost: u64,
    pub reputation_score: i64,
    pub total_staked: u64,
    pub slash_multiplier: u64,
    pub staker_count: u32,
    pub created_slot: u64,
    pub created_at: i64,
    pub bump: u8,
}
