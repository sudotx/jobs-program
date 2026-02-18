use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("wAid3rkaMeJghkY1okUzBUU4ewsPF1A5nxoJxJHwKyM");

#[program]
pub mod freelance_escrow {
    use super::*;

    pub fn initialize_platform(
        ctx: Context<InitializePlatform>,
        fee_bps: u16,
        treasury: Pubkey,
        default_lien_timeout_slots: u64,
    ) -> Result<()> {
        instructions::initialize_platform::handler(
            ctx,
            fee_bps,
            treasury,
            default_lien_timeout_slots,
        )
    }

    pub fn register_provider(ctx: Context<RegisterProvider>) -> Result<()> {
        instructions::register_provider::handler(ctx)
    }

    pub fn create_job(ctx: Context<CreateJob>, params: CreateJobParams) -> Result<()> {
        instructions::create_job::handler(ctx, params)
    }

    pub fn accept_job(ctx: Context<AcceptJob>) -> Result<()> {
        instructions::accept_job::handler(ctx)
    }

    pub fn complete_job(ctx: Context<CompleteJob>) -> Result<()> {
        instructions::complete_job::handler(ctx)
    }

    pub fn cancel_job(ctx: Context<CancelJob>) -> Result<()> {
        instructions::cancel_job::handler(ctx)
    }

    pub fn initiate_lien(ctx: Context<InitiateLien>) -> Result<()> {
        instructions::initiate_lien::handler(ctx)
    }

    pub fn resolve_lien(ctx: Context<ResolveLien>, params: ResolveLienParams) -> Result<()> {
        instructions::resolve_lien::handler(ctx, params)
    }

    pub fn mutual_resolve_lien(
        ctx: Context<MutualResolveLien>,
        params: ResolveLienParams,
    ) -> Result<()> {
        instructions::mutual_resolve_lien::handler(ctx, params)
    }

    pub fn force_resolve_lien(ctx: Context<ForceResolveLien>) -> Result<()> {
        instructions::force_resolve_lien::handler(ctx)
    }

    pub fn stake_on_provider(ctx: Context<StakeOnProvider>, amount: u64) -> Result<()> {
        instructions::stake_on_provider::handler(ctx, amount)
    }

    pub fn unstake_from_provider(ctx: Context<UnstakeFromProvider>, amount: u64) -> Result<()> {
        instructions::unstake_from_provider::handler(ctx, amount)
    }

    pub fn update_platform_config(
        ctx: Context<UpdatePlatformConfig>,
        params: UpdatePlatformParams,
    ) -> Result<()> {
        instructions::update_platform_config::handler(ctx, params)
    }
}
