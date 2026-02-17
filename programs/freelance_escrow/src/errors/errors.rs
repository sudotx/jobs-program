use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Platform is paused — no new jobs can be created")]
    PlatformPaused,

    #[msg("Job amount must be greater than zero")]
    InvalidAmount,

    #[msg("Expiry slot must be in the future and at least MIN_EXPIRY_SLOTS from now")]
    InvalidExpiry,

    #[msg("Job is not in the required status for this operation")]
    InvalidJobStatus,

    #[msg("Job has not expired yet — cannot cancel")]
    JobNotExpired,

    #[msg("Job has expired — cannot accept or complete")]
    JobExpired,

    #[msg("Only the client can perform this action")]
    UnauthorizedClient,

    #[msg("Only the assigned freelancer can perform this action")]
    UnauthorizedFreelancer,

    #[msg("Only the client or freelancer can initiate a lien")]
    UnauthorizedLienInitiator,

    #[msg("Only the assigned arbiter can resolve this lien")]
    UnauthorizedArbiter,

    #[msg("Lien deadline has not passed yet — cannot force resolve")]
    LienNotExpired,

    #[msg("No arbiters configured on the platform")]
    NoArbitersAvailable,

    #[msg("Freelancer share basis points must be <= 10000")]
    InvalidShareBps,

    #[msg("Platform fee basis points must be <= 1000")]
    InvalidFeeBps,

    #[msg("Arbiter list is full (max 10)")]
    ArbiterListFull,

    #[msg("Arbiter not found in the list")]
    ArbiterNotFound,

    #[msg("Insufficient stake balance")]
    InsufficientStake,

    #[msg("Stake cooldown period has not elapsed")]
    StakeCooldownActive,

    #[msg("Provider account not found — freelancer must register first")]
    ProviderNotRegistered,

    #[msg("Treasury address cannot be the default pubkey")]
    InvalidTreasury,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    #[msg("Job already has a freelancer assigned")]
    JobAlreadyAssigned,

    #[msg("Cannot cancel a job under active dispute")]
    CannotCancelDuringLien,
}
