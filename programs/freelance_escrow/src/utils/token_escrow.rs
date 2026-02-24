use anchor_lang::prelude::*;
use anchor_lang::solana_program::account_info::next_account_info;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_spl::token::spl_token::state::Account as SplTokenAccount;
use anchor_spl::token::{self, CloseAccount, Transfer};

use crate::errors::EscrowError;

pub struct CompleteTokenAccounts<'a, 'info> {
    pub token_program: &'a AccountInfo<'info>,
    pub token_vault: &'a AccountInfo<'info>,
    pub freelancer_token_account: &'a AccountInfo<'info>,
    pub treasury_token_account: &'a AccountInfo<'info>,
}

pub struct CancelTokenAccounts<'a, 'info> {
    pub token_program: &'a AccountInfo<'info>,
    pub token_vault: &'a AccountInfo<'info>,
    pub client_token_account: &'a AccountInfo<'info>,
}

pub struct LienTokenAccounts<'a, 'info> {
    pub token_program: &'a AccountInfo<'info>,
    pub token_vault: &'a AccountInfo<'info>,
    pub client_token_account: &'a AccountInfo<'info>,
    pub freelancer_token_account: &'a AccountInfo<'info>,
    pub treasury_token_account: &'a AccountInfo<'info>,
}

pub fn is_token_job(payment_mint: Pubkey) -> bool {
    payment_mint != Pubkey::default()
}

pub fn parse_complete_token_accounts<'a, 'info>(
    remaining_accounts: &'a [AccountInfo<'info>],
    payment_mint: Pubkey,
    expected_vault: Pubkey,
    expected_authority: Pubkey,
    freelancer_wallet: Pubkey,
    treasury_wallet: Pubkey,
) -> Result<CompleteTokenAccounts<'a, 'info>> {
    let mut account_iter = remaining_accounts.iter();
    let token_program = next_account_info(&mut account_iter)
        .map_err(|_| error!(EscrowError::MissingTokenAccounts))?;
    let token_vault = next_account_info(&mut account_iter)
        .map_err(|_| error!(EscrowError::MissingTokenAccounts))?;
    let freelancer_token_account = next_account_info(&mut account_iter)
        .map_err(|_| error!(EscrowError::MissingTokenAccounts))?;
    let treasury_token_account = next_account_info(&mut account_iter)
        .map_err(|_| error!(EscrowError::MissingTokenAccounts))?;

    validate_token_program(token_program)?;
    validate_token_vault(
        token_vault,
        payment_mint,
        expected_vault,
        expected_authority,
    )?;
    validate_token_recipient(freelancer_token_account, payment_mint, freelancer_wallet)?;
    validate_token_recipient(treasury_token_account, payment_mint, treasury_wallet)?;

    Ok(CompleteTokenAccounts {
        token_program,
        token_vault,
        freelancer_token_account,
        treasury_token_account,
    })
}

pub fn parse_cancel_token_accounts<'a, 'info>(
    remaining_accounts: &'a [AccountInfo<'info>],
    payment_mint: Pubkey,
    expected_vault: Pubkey,
    expected_authority: Pubkey,
    client_wallet: Pubkey,
) -> Result<CancelTokenAccounts<'a, 'info>> {
    let mut account_iter = remaining_accounts.iter();
    let token_program = next_account_info(&mut account_iter)
        .map_err(|_| error!(EscrowError::MissingTokenAccounts))?;
    let token_vault = next_account_info(&mut account_iter)
        .map_err(|_| error!(EscrowError::MissingTokenAccounts))?;
    let client_token_account = next_account_info(&mut account_iter)
        .map_err(|_| error!(EscrowError::MissingTokenAccounts))?;

    validate_token_program(token_program)?;
    validate_token_vault(
        token_vault,
        payment_mint,
        expected_vault,
        expected_authority,
    )?;
    validate_token_recipient(client_token_account, payment_mint, client_wallet)?;

    Ok(CancelTokenAccounts {
        token_program,
        token_vault,
        client_token_account,
    })
}

pub fn parse_lien_token_accounts<'a, 'info>(
    remaining_accounts: &'a [AccountInfo<'info>],
    payment_mint: Pubkey,
    expected_vault: Pubkey,
    expected_authority: Pubkey,
    client_wallet: Pubkey,
    freelancer_wallet: Pubkey,
    treasury_wallet: Pubkey,
) -> Result<LienTokenAccounts<'a, 'info>> {
    let mut account_iter = remaining_accounts.iter();
    let token_program = next_account_info(&mut account_iter)
        .map_err(|_| error!(EscrowError::MissingTokenAccounts))?;
    let token_vault = next_account_info(&mut account_iter)
        .map_err(|_| error!(EscrowError::MissingTokenAccounts))?;
    let client_token_account = next_account_info(&mut account_iter)
        .map_err(|_| error!(EscrowError::MissingTokenAccounts))?;
    let freelancer_token_account = next_account_info(&mut account_iter)
        .map_err(|_| error!(EscrowError::MissingTokenAccounts))?;
    let treasury_token_account = next_account_info(&mut account_iter)
        .map_err(|_| error!(EscrowError::MissingTokenAccounts))?;

    validate_token_program(token_program)?;
    validate_token_vault(
        token_vault,
        payment_mint,
        expected_vault,
        expected_authority,
    )?;
    validate_token_recipient(client_token_account, payment_mint, client_wallet)?;
    validate_token_recipient(freelancer_token_account, payment_mint, freelancer_wallet)?;
    validate_token_recipient(treasury_token_account, payment_mint, treasury_wallet)?;

    Ok(LienTokenAccounts {
        token_program,
        token_vault,
        client_token_account,
        freelancer_token_account,
        treasury_token_account,
    })
}

pub fn transfer_from_vault<'info>(
    token_program: &AccountInfo<'info>,
    token_vault: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let cpi_context = CpiContext::new_with_signer(
        token_program.clone(),
        Transfer {
            from: token_vault.clone(),
            to: destination.clone(),
            authority: authority.clone(),
        },
        signer_seeds,
    );
    token::transfer(cpi_context, amount)
}

pub fn close_vault<'info>(
    token_program: &AccountInfo<'info>,
    token_vault: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let cpi_context = CpiContext::new_with_signer(
        token_program.clone(),
        CloseAccount {
            account: token_vault.clone(),
            destination: destination.clone(),
            authority: authority.clone(),
        },
        signer_seeds,
    );
    token::close_account(cpi_context)
}

fn validate_token_program(token_program: &AccountInfo<'_>) -> Result<()> {
    require_keys_eq!(
        token_program.key(),
        token::ID,
        EscrowError::InvalidTokenProgram
    );
    Ok(())
}

fn validate_token_vault(
    token_vault_account: &AccountInfo<'_>,
    expected_mint: Pubkey,
    expected_vault: Pubkey,
    expected_authority: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        token_vault_account.key(),
        expected_vault,
        EscrowError::InvalidTokenAccount
    );

    let vault_state = unpack_token_account(token_vault_account)?;
    require_keys_eq!(
        vault_state.mint,
        expected_mint,
        EscrowError::InvalidPaymentMint
    );
    require_keys_eq!(
        vault_state.owner,
        expected_authority,
        EscrowError::InvalidTokenAccount
    );
    Ok(())
}

fn validate_token_recipient(
    token_account: &AccountInfo<'_>,
    expected_mint: Pubkey,
    expected_owner: Pubkey,
) -> Result<()> {
    let token_state = unpack_token_account(token_account)?;
    require_keys_eq!(
        token_state.mint,
        expected_mint,
        EscrowError::InvalidPaymentMint
    );
    require_keys_eq!(
        token_state.owner,
        expected_owner,
        EscrowError::InvalidTokenAccount
    );
    Ok(())
}

fn unpack_token_account(account: &AccountInfo<'_>) -> Result<SplTokenAccount> {
    require_keys_eq!(*account.owner, token::ID, EscrowError::InvalidTokenAccount);

    let data = account.try_borrow_data()?;
    SplTokenAccount::unpack(&data).map_err(|_| error!(EscrowError::InvalidTokenAccount))
}
