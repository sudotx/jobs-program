import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";

import {
  getClientAccountPDA,
  getJobPDA,
  getPlatformConfigPDA,
  getProviderPDA,
} from "./pda";

let currentPlatformAdmin: PublicKey | null = null;

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

export async function initializePlatform(
  program: Program,
  admin: Keypair,
  feeBps: number,
  treasury: PublicKey,
  defaultLienTimeoutSlots = 100,
): Promise<void> {
  const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  await program.methods
    .initializePlatform(feeBps, treasury, new anchor.BN(defaultLienTimeoutSlots))
    .accounts({
      admin: admin.publicKey,
      platformConfig,
      systemProgram: SystemProgram.programId,
    })
    .signers([admin])
    .rpc();

  currentPlatformAdmin = admin.publicKey;
}

export async function registerProvider(program: Program, freelancer: Keypair): Promise<void> {
  const [providerAccount] = getProviderPDA(program.programId, freelancer.publicKey);
  await program.methods
    .registerProvider()
    .accounts({
      freelancer: freelancer.publicKey,
      providerAccount,
      systemProgram: SystemProgram.programId,
    })
    .signers([freelancer])
    .rpc();
}

export async function createJob(
  program: Program,
  client: Keypair,
  amount: number,
  expirySlots: number,
): Promise<{ pda: PublicKey; nonce: number }> {
  if (!currentPlatformAdmin) {
    throw new Error("initializePlatform must run before createJob");
  }

  const [platformConfig] = getPlatformConfigPDA(program.programId, currentPlatformAdmin);
  const [clientAccount] = getClientAccountPDA(program.programId, client.publicKey);

  const existingClient = await program.account.clientAccount.fetchNullable(clientAccount);

  console.log({ existingClient });

  const nonce = existingClient ? existingClient.jobNonce.toNumber() : 0;

  const [jobPda] = getJobPDA(program.programId, client.publicKey, nonce);
  const currentSlot = await program.provider.connection.getSlot("confirmed");
  const expirySlot = currentSlot + expirySlots;

  await program.methods
    .createJob({ amount: new anchor.BN(amount), expirySlot: new anchor.BN(expirySlot) })
    .accounts({
      client: client.publicKey,
      platformConfig,
      clientAccount,
      jobAccount: jobPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([client])
    .rpc();

  return { pda: jobPda, nonce };
}

export async function acceptJob(
  program: Program,
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
    })
    .signers([freelancer])
    .rpc();
}
