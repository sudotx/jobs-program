use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct StakingAccount {
    pub staker: Pubkey,
    pub freelancer: Pubkey,
    pub amount: u64,
    pub last_stake_slot: u64,
    pub bump: u8,
}
