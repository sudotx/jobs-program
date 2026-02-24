import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AccountMeta,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import { FreelanceEscrow } from "../../target/types/freelance_escrow";
import {
  getClientAccountPDA,
  getJobPDA,
  getPlatformConfigPDA,
  getProviderPDA,
  getStakePDA,
  getStakeVaultPDA,
  getVaultPDA,
} from "./pda";

export const MIN_EXPIRY_SLOTS = 9_000;

const toBN = (value: number | bigint): anchor.BN => new anchor.BN(BigInt(value).toString());

type UpdatePlatformParams = {
  feeBps: number | null;
  treasury: PublicKey | null;
  stakingTokenMint: PublicKey | null;
  addArbiter: PublicKey | null;
  removeArbiter: PublicKey | null;
  addPaymentMint: PublicKey | null;
  removePaymentMint: PublicKey | null;
  defaultLienTimeoutSlots: anchor.BN | null;
  forceResolutionFreelancerShareBps: number | null;
  minProviderStakeForAccept: anchor.BN | null;
  minProviderAgeSlotsForAccept: anchor.BN | null;
  minReputationJobAmount: anchor.BN | null;
  disputeSlashingEnabled: boolean | null;
  disputeSlashBps: number | null;
  paused: boolean | null;
};

export function defaultUpdatePlatformParams(): UpdatePlatformParams {
  return {
    feeBps: null,
    treasury: null,
    stakingTokenMint: null,
    addArbiter: null,
    removeArbiter: null,
    addPaymentMint: null,
    removePaymentMint: null,
    defaultLienTimeoutSlots: null,
    forceResolutionFreelancerShareBps: null,
    minProviderStakeForAccept: null,
    minProviderAgeSlotsForAccept: null,
    minReputationJobAmount: null,
    disputeSlashingEnabled: null,
    disputeSlashBps: null,
    paused: null,
  };
}

export async function createAndFundWallet(
  provider: anchor.AnchorProvider,
  sol: number,
): Promise<Keypair> {
  const wallet = Keypair.generate();
  const sig = await provider.connection.requestAirdrop(
    wallet.publicKey,
    Math.floor(sol * LAMPORTS_PER_SOL),
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
  return wallet;
}

export async function createTestMint(
  provider: anchor.AnchorProvider,
  authority: Keypair,
  decimals = 6,
): Promise<PublicKey> {
  return createMint(
    provider.connection,
    authority,
    authority.publicKey,
    null,
    decimals,
  );
}

export async function createAta(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  const existing = await provider.connection.getAccountInfo(ata, "confirmed");
  if (!existing) {
    await createAssociatedTokenAccount(provider.connection, payer, mint, owner);
  }
  return ata;
}

export async function mintTokens(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  mint: PublicKey,
  destination: PublicKey,
  amount: number | bigint,
): Promise<void> {
  await mintTo(
    provider.connection,
    payer,
    mint,
    destination,
    payer,
    BigInt(amount),
  );
}

export async function tokenBalance(
  provider: anchor.AnchorProvider,
  ata: PublicKey,
): Promise<bigint> {
  const account = await getAccount(provider.connection, ata);
  return account.amount;
}

export async function initializePlatform(
  program: Program<FreelanceEscrow>,
  admin: Keypair,
  feeBps: number,
  treasury: PublicKey,
  defaultLienTimeoutSlots = 100,
): Promise<PublicKey> {
  const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  await program.methods
    .initializePlatform(feeBps, treasury, toBN(defaultLienTimeoutSlots))
    .accounts({
      admin: admin.publicKey,
      platformConfig,
      systemProgram: SystemProgram.programId,
    })
    .signers([admin])
    .rpc();
  return platformConfig;
}

export async function updatePlatformConfig(
  program: Program<FreelanceEscrow>,
  admin: Keypair,
  platformConfig: PublicKey,
  patch: Partial<UpdatePlatformParams>,
): Promise<void> {
  await program.methods
    .updatePlatformConfig({
      ...defaultUpdatePlatformParams(),
      ...patch,
    })
    .accounts({
      admin: admin.publicKey,
      platformConfig,
    })
    .signers([admin])
    .rpc();
}

export async function registerProvider(
  program: Program<FreelanceEscrow>,
  platformConfig: PublicKey,
  freelancer: Keypair,
): Promise<PublicKey> {
  const [providerAccount] = getProviderPDA(program.programId, freelancer.publicKey);
  await program.methods
    .registerProvider()
    .accounts({
      freelancer: freelancer.publicKey,
      providerAccount,
      platformConfig,
      systemProgram: SystemProgram.programId,
    })
    .signers([freelancer])
    .rpc();
  return providerAccount;
}

export async function createTokenJob(
  program: Program<FreelanceEscrow>,
  platformConfig: PublicKey,
  client: Keypair,
  paymentMint: PublicKey,
  clientTokenAccount: PublicKey,
  amount: number | bigint,
  expirySlotsFromNow = MIN_EXPIRY_SLOTS + 25,
): Promise<{ jobPda: PublicKey; nonce: number; tokenVault: PublicKey }> {
  const [clientAccount] = getClientAccountPDA(program.programId, client.publicKey);
  const existingClient = await program.account.clientAccount.fetchNullable(clientAccount);
  const nonce = existingClient ? Number(existingClient.jobNonce.toString()) : 0;
  const [jobPda] = getJobPDA(program.programId, client.publicKey, nonce);
  const [tokenVault] = getVaultPDA(program.programId, jobPda);
  const currentSlot = await program.provider.connection.getSlot("confirmed");
  const expirySlot = currentSlot + expirySlotsFromNow;

  await program.methods
    .createTokenJob({
      amount: toBN(amount),
      expirySlot: toBN(expirySlot),
    })
    .accounts({
      client: client.publicKey,
      platformConfig,
      clientAccount,
      jobAccount: jobPda,
      paymentMint,
      clientTokenAccount,
      tokenVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([client])
    .rpc();

  return { jobPda, nonce, tokenVault };
}

export async function createTokenMilestoneJob(
  program: Program<FreelanceEscrow>,
  platformConfig: PublicKey,
  client: Keypair,
  paymentMint: PublicKey,
  clientTokenAccount: PublicKey,
  milestoneAmounts: Array<number | bigint>,
  expirySlotsFromNow = MIN_EXPIRY_SLOTS + 25,
): Promise<{ jobPda: PublicKey; nonce: number; tokenVault: PublicKey }> {
  const [clientAccount] = getClientAccountPDA(program.programId, client.publicKey);
  const existingClient = await program.account.clientAccount.fetchNullable(clientAccount);
  const nonce = existingClient ? Number(existingClient.jobNonce.toString()) : 0;
  const [jobPda] = getJobPDA(program.programId, client.publicKey, nonce);
  const [tokenVault] = getVaultPDA(program.programId, jobPda);
  const currentSlot = await program.provider.connection.getSlot("confirmed");
  const expirySlot = currentSlot + expirySlotsFromNow;

  await program.methods
    .createTokenMilestoneJob({
      milestoneAmounts: milestoneAmounts.map((v) => toBN(v)),
      expirySlot: toBN(expirySlot),
    })
    .accounts({
      client: client.publicKey,
      platformConfig,
      clientAccount,
      jobAccount: jobPda,
      paymentMint,
      clientTokenAccount,
      tokenVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([client])
    .rpc();

  return { jobPda, nonce, tokenVault };
}

export async function acceptJob(
  program: Program<FreelanceEscrow>,
  platformConfig: PublicKey,
  freelancer: Keypair,
  jobPda: PublicKey,
): Promise<void> {
  const [providerAccount] = getProviderPDA(program.programId, freelancer.publicKey);
  await program.methods
    .acceptJob()
    .accounts({
      freelancer: freelancer.publicKey,
      jobAccount: jobPda,
      providerAccount,
      platformConfig,
    })
    .signers([freelancer])
    .rpc();
}

function completeRemainingAccounts(
  tokenVault: PublicKey,
  freelancerTokenAccount: PublicKey,
  treasuryTokenAccount: PublicKey,
): AccountMeta[] {
  return [
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: tokenVault, isSigner: false, isWritable: true },
    { pubkey: freelancerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: treasuryTokenAccount, isSigner: false, isWritable: true },
  ];
}

function cancelRemainingAccounts(tokenVault: PublicKey, clientTokenAccount: PublicKey): AccountMeta[] {
  return [
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: tokenVault, isSigner: false, isWritable: true },
    { pubkey: clientTokenAccount, isSigner: false, isWritable: true },
  ];
}

function lienRemainingAccounts(
  tokenVault: PublicKey,
  clientTokenAccount: PublicKey,
  freelancerTokenAccount: PublicKey,
  treasuryTokenAccount: PublicKey,
): AccountMeta[] {
  return [
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: tokenVault, isSigner: false, isWritable: true },
    { pubkey: clientTokenAccount, isSigner: false, isWritable: true },
    { pubkey: freelancerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: treasuryTokenAccount, isSigner: false, isWritable: true },
  ];
}

export async function completeJob(
  program: Program<FreelanceEscrow>,
  platformConfig: PublicKey,
  client: Keypair,
  freelancer: PublicKey,
  jobPda: PublicKey,
  treasury: PublicKey,
  tokenVault: PublicKey,
  freelancerTokenAccount: PublicKey,
  treasuryTokenAccount: PublicKey,
): Promise<void> {
  const [providerAccount] = getProviderPDA(program.programId, freelancer);
  await program.methods
    .completeJob()
    .accounts({
      jobAccount: jobPda,
      client: client.publicKey,
      freelancerWallet: freelancer,
      providerAccount,
      platformConfig,
      treasury,
    })
    .remainingAccounts(
      completeRemainingAccounts(tokenVault, freelancerTokenAccount, treasuryTokenAccount),
    )
    .signers([client])
    .rpc();
}

export async function completeMilestone(
  program: Program<FreelanceEscrow>,
  platformConfig: PublicKey,
  client: Keypair,
  freelancer: PublicKey,
  jobPda: PublicKey,
  treasury: PublicKey,
  tokenVault: PublicKey,
  freelancerTokenAccount: PublicKey,
  treasuryTokenAccount: PublicKey,
): Promise<void> {
  const [providerAccount] = getProviderPDA(program.programId, freelancer);
  await program.methods
    .completeMilestone()
    .accounts({
      jobAccount: jobPda,
      client: client.publicKey,
      freelancerWallet: freelancer,
      providerAccount,
      platformConfig,
      treasury,
    })
    .remainingAccounts(
      completeRemainingAccounts(tokenVault, freelancerTokenAccount, treasuryTokenAccount),
    )
    .signers([client])
    .rpc();
}

export async function cancelJob(
  program: Program<FreelanceEscrow>,
  platformConfig: PublicKey,
  client: Keypair,
  jobPda: PublicKey,
  tokenVault: PublicKey,
  clientTokenAccount: PublicKey,
): Promise<void> {
  await program.methods
    .cancelJob()
    .accounts({
      jobAccount: jobPda,
      client: client.publicKey,
      platformConfig,
    })
    .remainingAccounts(cancelRemainingAccounts(tokenVault, clientTokenAccount))
    .signers([client])
    .rpc();
}

export async function initiateLien(
  program: Program<FreelanceEscrow>,
  platformConfig: PublicKey,
  signer: Keypair,
  jobPda: PublicKey,
): Promise<void> {
  await program.methods
    .initiateLien()
    .accounts({
      signer: signer.publicKey,
      jobAccount: jobPda,
      platformConfig,
    })
    .signers([signer])
    .rpc();
}

export async function resolveLien(
  program: Program<FreelanceEscrow>,
  platformConfig: PublicKey,
  arbiter: Keypair,
  jobPda: PublicKey,
  clientWallet: PublicKey,
  freelancerWallet: PublicKey,
  treasury: PublicKey,
  tokenVault: PublicKey,
  clientTokenAccount: PublicKey,
  freelancerTokenAccount: PublicKey,
  treasuryTokenAccount: PublicKey,
  freelancerShareBps: number,
): Promise<void> {
  const [providerAccount] = getProviderPDA(program.programId, freelancerWallet);
  await program.methods
    .resolveLien({ freelancerShareBps })
    .accounts({
      jobAccount: jobPda,
      arbiter: arbiter.publicKey,
      clientWallet,
      freelancerWallet,
      providerAccount,
      platformConfig,
      treasury,
    })
    .remainingAccounts(
      lienRemainingAccounts(
        tokenVault,
        clientTokenAccount,
        freelancerTokenAccount,
        treasuryTokenAccount,
      ),
    )
    .signers([arbiter])
    .rpc();
}

export async function forceResolveLien(
  program: Program<FreelanceEscrow>,
  platformConfig: PublicKey,
  crank: Keypair,
  jobPda: PublicKey,
  clientWallet: PublicKey,
  freelancerWallet: PublicKey,
  treasury: PublicKey,
  tokenVault: PublicKey,
  clientTokenAccount: PublicKey,
  freelancerTokenAccount: PublicKey,
  treasuryTokenAccount: PublicKey,
): Promise<void> {
  const [providerAccount] = getProviderPDA(program.programId, freelancerWallet);
  await program.methods
    .forceResolveLien()
    .accounts({
      crank: crank.publicKey,
      jobAccount: jobPda,
      clientWallet,
      freelancerWallet,
      providerAccount,
      platformConfig,
      treasury,
    })
    .remainingAccounts(
      lienRemainingAccounts(
        tokenVault,
        clientTokenAccount,
        freelancerTokenAccount,
        treasuryTokenAccount,
      ),
    )
    .signers([crank])
    .rpc();
}

export async function stakeOnProvider(
  program: Program<FreelanceEscrow>,
  platformConfig: PublicKey,
  staker: Keypair,
  freelancer: PublicKey,
  stakingMint: PublicKey,
  stakerTokenAccount: PublicKey,
  amount: number | bigint,
): Promise<{ providerAccount: PublicKey; stakingAccount: PublicKey; stakingVault: PublicKey }> {
  const [providerAccount] = getProviderPDA(program.programId, freelancer);
  const [stakingAccount] = getStakePDA(program.programId, staker.publicKey, freelancer);
  const [stakingVault] = getStakeVaultPDA(program.programId, stakingAccount);

  await program.methods
    .stakeOnProvider(toBN(amount))
    .accounts({
      staker: staker.publicKey,
      providerAccount,
      stakingAccount,
      platformConfig,
      stakingMint,
      stakerTokenAccount,
      stakingVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([staker])
    .rpc();

  return { providerAccount, stakingAccount, stakingVault };
}

export async function unstakeFromProvider(
  program: Program<FreelanceEscrow>,
  platformConfig: PublicKey,
  staker: Keypair,
  freelancer: PublicKey,
  stakingMint: PublicKey,
  stakerTokenAccount: PublicKey,
  slashRecipientTokenAccount: PublicKey,
  amount: number | bigint,
): Promise<void> {
  const [providerAccount] = getProviderPDA(program.programId, freelancer);
  const [stakingAccount] = getStakePDA(program.programId, staker.publicKey, freelancer);
  const [stakingVault] = getStakeVaultPDA(program.programId, stakingAccount);

  await program.methods
    .unstakeFromProvider(toBN(amount))
    .accounts({
      staker: staker.publicKey,
      stakingAccount,
      providerAccount,
      platformConfig,
      stakingMint,
      stakerTokenAccount,
      stakingVault,
      slashRecipientTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([staker])
    .rpc();
}

export async function tickSlots(
  provider: anchor.AnchorProvider,
  count = 2,
): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: provider.wallet.publicKey,
        lamports: 1,
      }),
    );
    await provider.sendAndConfirm(tx, []);
  }
}

export async function warpToSlot(
  provider: anchor.AnchorProvider,
  slot: number,
): Promise<boolean> {
  const conn = provider.connection as any;
  for (const method of ["warp_slot", "warpSlot"]) {
    try {
      const response = await conn._rpcRequest(method, [slot]);
      if (!response?.error) {
        return true;
      }
    } catch {
      // continue
    }
  }
  return false;
}
