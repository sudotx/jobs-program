/// Maximum platform fee: 10% (1000 basis points)
pub const MAX_FEE_BPS: u16 = 1_000;

/// Maximum arbiter count
pub const MAX_ARBITERS: usize = 10;

/// Maximum share for lien resolution
pub const MAX_SHARE_BPS: u16 = 10_000;

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
