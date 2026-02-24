use anchor_lang::prelude::*;

use crate::state::JobStatus;

#[account]
#[derive(InitSpace)]
pub struct JobAccount {
    pub client: Pubkey,
    pub freelancer: Pubkey,
    /// Remaining escrowed amount (decreases as milestones are released)
    pub amount: u64,
    /// Original total amount locked at creation time
    pub total_amount: u64,
    pub status: JobStatus,
    pub job_nonce: u64,
    pub created_slot: u64,
    pub expiry_slot: u64,
    #[max_len(20)]
    pub milestone_amounts: Vec<u64>,
    pub next_milestone_index: u8,
    pub lien_initiator: Pubkey,
    pub lien_deadline_slot: u64,
    pub arbiter: Pubkey,
    pub fee_bps_snapshot: u16,
    pub treasury_snapshot: Pubkey,
    pub payment_mint: Pubkey,
    pub token_vault: Pubkey,
    pub bump: u8,
}
