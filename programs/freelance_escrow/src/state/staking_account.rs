use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct StakingAccount {
    pub staker: Pubkey,
    pub freelancer: Pubkey,
    pub staking_mint: Pubkey,
    pub token_vault: Pubkey,
    /// Internal share balance used to apply global dispute slashing lazily.
    pub amount: u64,
    pub last_stake_slot: u64,
    pub bump: u8,
}
