use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PlatformConfig {
    pub admin: Pubkey,
    pub fee_bps: u16,
    pub treasury: Pubkey,
    #[max_len(10)]
    pub arbiters: Vec<Pubkey>,
    pub default_lien_timeout_slots: u64,
    pub paused: bool,
    pub bump: u8,
}
