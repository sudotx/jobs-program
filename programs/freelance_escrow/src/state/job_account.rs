use anchor_lang::prelude::*;

use crate::state::JobStatus;

#[account]
#[derive(InitSpace)]
pub struct JobAccount {
    pub client: Pubkey,
    pub freelancer: Pubkey,
    pub amount: u64,
    pub status: JobStatus,
    pub job_nonce: u64,
    pub created_slot: u64,
    pub expiry_slot: u64,
    pub lien_initiator: Pubkey,
    pub lien_deadline_slot: u64,
    pub arbiter: Pubkey,
    pub fee_bps_snapshot: u16,
    pub treasury_snapshot: Pubkey,
    pub bump: u8,
}
