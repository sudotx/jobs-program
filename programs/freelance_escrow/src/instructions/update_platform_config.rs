use anchor_lang::prelude::*;

use crate::errors::EscrowError;
use crate::events::PlatformConfigUpdated;
use crate::state::PlatformConfig;
use crate::utils::{MAX_ARBITERS, MAX_FEE_BPS, MAX_PAYMENT_MINTS, MAX_SHARE_BPS};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdatePlatformParams {
    pub fee_bps: Option<u16>,
    pub treasury: Option<Pubkey>,
    pub staking_token_mint: Option<Pubkey>,
    pub add_arbiter: Option<Pubkey>,
    pub remove_arbiter: Option<Pubkey>,
    pub add_payment_mint: Option<Pubkey>,
    pub remove_payment_mint: Option<Pubkey>,
    pub default_lien_timeout_slots: Option<u64>,
    pub force_resolution_freelancer_share_bps: Option<u16>,
    pub min_provider_stake_for_accept: Option<u64>,
    pub min_provider_age_slots_for_accept: Option<u64>,
    pub min_reputation_job_amount: Option<u64>,
    pub dispute_slashing_enabled: Option<bool>,
    pub dispute_slash_bps: Option<u16>,
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

    if let Some(payment_mint) = params.remove_payment_mint {
        let position = platform_config
            .allowed_payment_mints
            .iter()
            .position(|entry| *entry == payment_mint)
            .ok_or_else(|| error!(EscrowError::PaymentMintNotFound))?;
        platform_config.allowed_payment_mints.remove(position);
    }

    if let Some(staking_token_mint) = params.staking_token_mint {
        require!(
            staking_token_mint != Pubkey::default(),
            EscrowError::InvalidStakingTokenMint
        );
        require!(
            !platform_config
                .allowed_payment_mints
                .contains(&staking_token_mint),
            EscrowError::PaymentMintConflictsWithStakingMint
        );
        platform_config.staking_token_mint = staking_token_mint;
    }

    if let Some(payment_mint) = params.add_payment_mint {
        require!(
            payment_mint != Pubkey::default(),
            EscrowError::InvalidPaymentMint
        );
        require!(
            payment_mint != platform_config.staking_token_mint,
            EscrowError::PaymentMintConflictsWithStakingMint
        );

        if !platform_config
            .allowed_payment_mints
            .contains(&payment_mint)
        {
            require!(
                platform_config.allowed_payment_mints.len() < MAX_PAYMENT_MINTS,
                EscrowError::PaymentMintListFull
            );
            platform_config.allowed_payment_mints.push(payment_mint);
        }
    }

    if let Some(timeout) = params.default_lien_timeout_slots {
        require!(timeout > 0, EscrowError::InvalidExpiry);
        platform_config.default_lien_timeout_slots = timeout;
    }

    if let Some(share_bps) = params.force_resolution_freelancer_share_bps {
        require!(share_bps <= MAX_SHARE_BPS, EscrowError::InvalidShareBps);
        platform_config.force_resolution_freelancer_share_bps = share_bps;
    }

    if let Some(min_provider_stake_for_accept) = params.min_provider_stake_for_accept {
        platform_config.min_provider_stake_for_accept = min_provider_stake_for_accept;
    }

    if let Some(min_provider_age_slots_for_accept) = params.min_provider_age_slots_for_accept {
        platform_config.min_provider_age_slots_for_accept = min_provider_age_slots_for_accept;
    }

    if let Some(min_reputation_job_amount) = params.min_reputation_job_amount {
        platform_config.min_reputation_job_amount = min_reputation_job_amount;
    }

    if let Some(dispute_slash_bps) = params.dispute_slash_bps {
        require!(
            dispute_slash_bps < MAX_SHARE_BPS,
            EscrowError::InvalidDisputeSlashBps
        );
        platform_config.dispute_slash_bps = dispute_slash_bps;
    }

    if let Some(dispute_slashing_enabled) = params.dispute_slashing_enabled {
        platform_config.dispute_slashing_enabled = dispute_slashing_enabled;
    }

    if let Some(paused) = params.paused {
        platform_config.paused = paused;
    }

    let arbiter_count: u8 = platform_config
        .arbiters
        .len()
        .try_into()
        .map_err(|_| error!(EscrowError::MathOverflow))?;
    let payment_mint_count: u8 = platform_config
        .allowed_payment_mints
        .len()
        .try_into()
        .map_err(|_| error!(EscrowError::MathOverflow))?;

    emit!(PlatformConfigUpdated {
        admin: ctx.accounts.admin.key(),
        fee_bps: platform_config.fee_bps,
        treasury: platform_config.treasury,
        staking_token_mint: platform_config.staking_token_mint,
        default_lien_timeout_slots: platform_config.default_lien_timeout_slots,
        force_resolution_freelancer_share_bps: platform_config
            .force_resolution_freelancer_share_bps,
        min_provider_stake_for_accept: platform_config.min_provider_stake_for_accept,
        min_provider_age_slots_for_accept: platform_config.min_provider_age_slots_for_accept,
        min_reputation_job_amount: platform_config.min_reputation_job_amount,
        dispute_slashing_enabled: platform_config.dispute_slashing_enabled,
        dispute_slash_bps: platform_config.dispute_slash_bps,
        paused: platform_config.paused,
        arbiter_count,
        payment_mint_count,
    });

    Ok(())
}
