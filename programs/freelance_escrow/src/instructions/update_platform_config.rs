use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::PlatformConfigUpdated;
use crate::state::PlatformConfig;
use crate::utils::{MAX_ARBITERS, MAX_FEE_BPS};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdatePlatformParams {
    pub fee_bps: Option<u16>,
    pub treasury: Option<Pubkey>,
    pub add_arbiter: Option<Pubkey>,
    pub remove_arbiter: Option<Pubkey>,
    pub default_lien_timeout_slots: Option<u64>,
    pub paused: Option<bool>,
}

#[derive(Accounts)]
pub struct UpdatePlatformConfig<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"platform", admin.key().as_ref()],
        bump = platform_config.bump,
        constraint = platform_config.admin == admin.key() @ EscrowError::UnauthorizedClient,
    )]
    pub platform_config: Account<'info, PlatformConfig>,
}

pub fn handler(ctx: Context<UpdatePlatformConfig>, params: UpdatePlatformParams) -> Result<()> {
    let platform_config = &mut ctx.accounts.platform_config;

    if let Some(fee_bps) = params.fee_bps {
        require!(fee_bps <= MAX_FEE_BPS, EscrowError::InvalidFeeBps);
        platform_config.fee_bps = fee_bps;
    }

    if let Some(treasury) = params.treasury {
        require!(treasury != Pubkey::default(), EscrowError::InvalidTreasury);
        platform_config.treasury = treasury;
    }

    if let Some(arbiter) = params.add_arbiter {
        if !platform_config.arbiters.contains(&arbiter) {
            require!(
                platform_config.arbiters.len() < MAX_ARBITERS,
                EscrowError::ArbiterListFull
            );
            platform_config.arbiters.push(arbiter);
        }
    }

    if let Some(arbiter) = params.remove_arbiter {
        let position = platform_config
            .arbiters
            .iter()
            .position(|entry| *entry == arbiter)
            .ok_or_else(|| error!(EscrowError::ArbiterNotFound))?;
        platform_config.arbiters.remove(position);
    }

    if let Some(timeout) = params.default_lien_timeout_slots {
        require!(timeout > 0, EscrowError::InvalidExpiry);
        platform_config.default_lien_timeout_slots = timeout;
    }

    if let Some(paused) = params.paused {
        platform_config.paused = paused;
    }

    let arbiter_count: u8 = platform_config
        .arbiters
        .len()
        .try_into()
        .map_err(|_| error!(EscrowError::MathOverflow))?;

    emit!(PlatformConfigUpdated {
        admin: ctx.accounts.admin.key(),
        fee_bps: platform_config.fee_bps,
        treasury: platform_config.treasury,
        default_lien_timeout_slots: platform_config.default_lien_timeout_slots,
        paused: platform_config.paused,
        arbiter_count,
    });

    Ok(())
}
