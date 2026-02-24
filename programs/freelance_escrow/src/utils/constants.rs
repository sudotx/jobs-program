/// Maximum platform fee: 10% (1000 basis points)
pub const MAX_FEE_BPS: u16 = 1_000;

/// Maximum arbiter count
pub const MAX_ARBITERS: usize = 10;

/// Maximum supported payment mints
pub const MAX_PAYMENT_MINTS: usize = 10;

/// Maximum share for lien resolution
pub const MAX_SHARE_BPS: u16 = 10_000;

/// Default forced-resolution freelancer share: 50%
pub const DEFAULT_FORCE_RESOLUTION_SHARE_BPS: u16 = 5_000;

/// A dispute outcome below this freelancer share is considered a provider loss
pub const DISPUTE_LOSS_THRESHOLD_BPS: u16 = 5_000;

/// Slash multiplier scaling precision (1.0 == 1_000_000_000)
pub const SLASH_MULTIPLIER_SCALE: u64 = 1_000_000_000;

/// Default dispute slashing policy
pub const DEFAULT_DISPUTE_SLASH_BPS: u16 = 0;

/// Reputation confidence reaches full weight after this many resolved jobs.
pub const REPUTATION_CONFIDENCE_CAP_JOBS: u64 = 50;

/// Base confidence floor (10%) for brand-new providers.
pub const REPUTATION_BASE_CONFIDENCE_BPS: u16 = 1_000;

/// Maximum milestones per job
pub const MAX_MILESTONES: usize = 20;

/// Minimum job expiry (slots) — approximately 1 hour
pub const MIN_EXPIRY_SLOTS: u64 = 9_000;

/// Unstaking cooldown (slots) — approximately 2 hours
pub const COOLDOWN_SLOTS: u64 = 18_000;

/// Default lien timeout (slots) — approximately 3 days
pub const DEFAULT_LIEN_TIMEOUT: u64 = 648_000;

/// Reputation weights
pub const COMPLETION_WEIGHT: i64 = 100;
pub const DISPUTE_PENALTY: i64 = 250;
pub const STAKE_DIVISOR: u64 = 1_000_000_000;
