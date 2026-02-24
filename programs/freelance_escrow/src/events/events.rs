use anchor_lang::prelude::*;

#[event]
pub struct PlatformInitialized {
    pub admin: Pubkey,
    pub fee_bps: u16,
    pub treasury: Pubkey,
    pub force_resolution_freelancer_share_bps: u16,
    pub min_provider_stake_for_accept: u64,
    pub min_provider_age_slots_for_accept: u64,
    pub min_reputation_job_amount: u64,
    pub dispute_slashing_enabled: bool,
    pub dispute_slash_bps: u16,
    pub staking_token_mint: Pubkey,
    pub payment_mint_count: u8,
}

#[event]
pub struct PlatformConfigUpdated {
    pub admin: Pubkey,
    pub fee_bps: u16,
    pub treasury: Pubkey,
    pub staking_token_mint: Pubkey,
    pub default_lien_timeout_slots: u64,
    pub force_resolution_freelancer_share_bps: u16,
    pub min_provider_stake_for_accept: u64,
    pub min_provider_age_slots_for_accept: u64,
    pub min_reputation_job_amount: u64,
    pub dispute_slashing_enabled: bool,
    pub dispute_slash_bps: u16,
    pub paused: bool,
    pub arbiter_count: u8,
    pub payment_mint_count: u8,
}

#[event]
pub struct ProviderRegistered {
    pub provider: Pubkey,
}

#[event]
pub struct JobCreated {
    pub pda: Pubkey,
    pub client: Pubkey,
    pub amount: u64,
    pub nonce: u64,
    pub expiry_slot: u64,
    pub milestone_count: u8,
    pub payment_mint: Pubkey,
    pub fee_bps_snapshot: u16,
}

#[event]
pub struct JobAccepted {
    pub pda: Pubkey,
    pub freelancer: Pubkey,
}

#[event]
pub struct JobCompleted {
    pub pda: Pubkey,
    pub client: Pubkey,
    pub freelancer: Pubkey,
    pub payout: u64,
    pub fee: u64,
}

#[event]
pub struct JobMilestoneCompleted {
    pub pda: Pubkey,
    pub client: Pubkey,
    pub freelancer: Pubkey,
    pub milestone_index: u8,
    pub milestone_amount: u64,
    pub payout: u64,
    pub fee: u64,
    pub remaining_amount: u64,
    pub completed_all: bool,
}

#[event]
pub struct JobCancelled {
    pub pda: Pubkey,
    pub client: Pubkey,
    pub refund_amount: u64,
}

#[event]
pub struct LienInitiated {
    pub pda: Pubkey,
    pub initiator: Pubkey,
    pub arbiter: Pubkey,
    pub deadline_slot: u64,
}

#[event]
pub struct LienResolved {
    pub pda: Pubkey,
    pub arbiter: Pubkey,
    pub freelancer_share_bps: u16,
    pub freelancer_payout: u64,
    pub client_refund: u64,
    pub fee: u64,
    pub slash_bps_applied: u16,
    pub slash_amount: u64,
}

#[event]
pub struct LienForceResolved {
    pub pda: Pubkey,
    pub freelancer_share_bps: u16,
    pub freelancer_payout: u64,
    pub client_refund: u64,
    pub slash_bps_applied: u16,
    pub slash_amount: u64,
}

#[event]
pub struct StakeDeposited {
    pub staker: Pubkey,
    pub freelancer: Pubkey,
    pub amount: u64,
    pub total_staked: u64,
}

#[event]
pub struct StakeWithdrawn {
    pub staker: Pubkey,
    pub freelancer: Pubkey,
    pub amount: u64,
    pub remaining: u64,
}
