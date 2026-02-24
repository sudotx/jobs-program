use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PlatformConfig {
    pub admin: Pubkey,
    pub fee_bps: u16,
    pub treasury: Pubkey,
    #[max_len(10)]
    pub arbiters: Vec<Pubkey>,
    #[max_len(10)]
    pub allowed_payment_mints: Vec<Pubkey>,
    pub staking_token_mint: Pubkey,
    pub default_lien_timeout_slots: u64,
    pub force_resolution_freelancer_share_bps: u16,
    pub min_provider_stake_for_accept: u64,
    pub min_provider_age_slots_for_accept: u64,
    pub min_reputation_job_amount: u64,
    pub dispute_slashing_enabled: bool,
    pub dispute_slash_bps: u16,
    pub paused: bool,
    pub bump: u8,
}
