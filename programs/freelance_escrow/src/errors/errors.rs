use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Platform is paused — mutating operations are disabled")]
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

    #[msg("Job client cannot accept their own job")]
    SelfAcceptNotAllowed,

    #[msg("Invalid milestone configuration")]
    InvalidMilestoneConfig,

    #[msg("This operation requires a milestone-based job")]
    NotMilestoneJob,

    #[msg("Milestone-based jobs must be settled via milestone completion")]
    MilestoneFlowRequired,

    #[msg("Missing required token accounts for token escrow flow")]
    MissingTokenAccounts,

    #[msg("Invalid token account provided")]
    InvalidTokenAccount,

    #[msg("Invalid token program provided")]
    InvalidTokenProgram,

    #[msg("Invalid payment mint for this operation")]
    InvalidPaymentMint,

    #[msg("Token-denominated payments are required")]
    TokenPaymentRequired,

    #[msg("Payment mint is not allowed by platform policy")]
    PaymentMintNotAllowed,

    #[msg("Payment mint list is full")]
    PaymentMintListFull,

    #[msg("Payment mint not found in policy list")]
    PaymentMintNotFound,

    #[msg("Invalid staking token mint")]
    InvalidStakingTokenMint,

    #[msg("Staking token mint is not configured")]
    StakingTokenMintUnset,

    #[msg("Payment mint cannot be the same as staking token mint")]
    PaymentMintConflictsWithStakingMint,

    #[msg("Dispute slash basis points must be < 10000")]
    InvalidDisputeSlashBps,

    #[msg("Provider does not meet minimum stake requirement for job acceptance")]
    InsufficientStakeForJobAcceptance,

    #[msg("Provider account age is below the minimum requirement for job acceptance")]
    ProviderTooNewForJobAcceptance,
}
