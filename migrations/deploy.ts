import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import * as dotenv from "dotenv";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import { FreelanceEscrow } from "../target/types/freelance_escrow";

dotenv.config({
  path: process.env.DOTENV_CONFIG_PATH ?? ".env",
});

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

const toBN = (value: string | number | bigint): anchor.BN =>
  new anchor.BN(BigInt(value).toString());

const parsePubkey = (value: string, label: string): PublicKey => {
  try {
    return new PublicKey(value.trim());
  } catch {
    throw new Error(`Invalid ${label}: ${value}`);
  }
};

const parsePubkeyList = (value: string | undefined): PublicKey[] => {
  if (!value || value.trim() === "") return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map((v) => parsePubkey(v, "pubkey list item"));
};

const parseBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
};

const emptyUpdate = (): UpdatePlatformParams => ({
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
});

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);

  const program = anchor.workspace.FreelanceEscrow as Program<FreelanceEscrow>;
  const admin = provider.wallet.publicKey;

  const feeBps = Number(process.env.FEE_BPS ?? "500");
  const treasury = process.env.TREASURY_PUBKEY
    ? parsePubkey(process.env.TREASURY_PUBKEY, "TREASURY_PUBKEY")
    : admin;
  const defaultLienTimeoutSlots = toBN(process.env.DEFAULT_LIEN_TIMEOUT_SLOTS ?? "648000");

  const stakingTokenMint = process.env.STAKING_TOKEN_MINT
    ? parsePubkey(process.env.STAKING_TOKEN_MINT, "STAKING_TOKEN_MINT")
    : null;

  const paymentMints = parsePubkeyList(process.env.PAYMENT_MINTS);
  const arbiters = parsePubkeyList(process.env.ARBITERS);

  const forceResolutionFreelancerShareBps = Number(
    process.env.FORCE_RESOLUTION_FREELANCER_SHARE_BPS ?? "5000",
  );
  const minProviderStakeForAccept = toBN(process.env.MIN_PROVIDER_STAKE_FOR_ACCEPT ?? "0");
  const minProviderAgeSlotsForAccept = toBN(process.env.MIN_PROVIDER_AGE_SLOTS_FOR_ACCEPT ?? "0");
  const minReputationJobAmount = toBN(process.env.MIN_REPUTATION_JOB_AMOUNT ?? "0");
  const disputeSlashingEnabled = parseBool(process.env.DISPUTE_SLASHING_ENABLED, false);
  const disputeSlashBps = Number(process.env.DISPUTE_SLASH_BPS ?? "0");
  const paused = parseBool(process.env.PAUSED, false);

  if (stakingTokenMint && paymentMints.some((m) => m.equals(stakingTokenMint))) {
    throw new Error("Invalid config: STAKING_TOKEN_MINT cannot be included in PAYMENT_MINTS");
  }

  const [platformConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("platform"), admin.toBuffer()],
    program.programId,
  );

  let alreadyInitialized = false;
  try {
    const existing = await program.account.platformConfig.fetch(platformConfigPda);
    alreadyInitialized = true;
    console.log("Platform already initialized:", platformConfigPda.toBase58());
    console.log("  Admin:", existing.admin.toBase58());
    console.log("  Fee BPS:", existing.feeBps);
    console.log("  Treasury:", existing.treasury.toBase58());
    console.log("  Staking Token Mint:", existing.stakingTokenMint.toBase58());
    console.log("  Allowed Payment Mints:", existing.allowedPaymentMints.length);
    console.log("  Arbiters:", existing.arbiters.length);
    console.log("  Force Resolution Share BPS:", existing.forceResolutionFreelancerShareBps);
    console.log("  Min Provider Stake For Accept:", existing.minProviderStakeForAccept.toString());
    console.log(
      "  Min Provider Age Slots For Accept:",
      existing.minProviderAgeSlotsForAccept.toString(),
    );
    console.log("  Min Reputation Job Amount:", existing.minReputationJobAmount.toString());
    console.log("  Dispute Slashing Enabled:", existing.disputeSlashingEnabled);
    console.log("  Dispute Slash BPS:", existing.disputeSlashBps);
    console.log("  Paused:", existing.paused);
  } catch {
    // Not initialized yet.
  }

  if (!alreadyInitialized) {
    console.log("Initializing platform...");
    console.log("  Admin:", admin.toBase58());
    console.log("  Fee BPS:", feeBps);
    console.log("  Treasury:", treasury.toBase58());
    console.log("  Lien Timeout Slots:", defaultLienTimeoutSlots.toString());

    const initTx = await program.methods
      .initializePlatform(feeBps, treasury, defaultLienTimeoutSlots)
      .accounts({
        admin,
        platformConfig: platformConfigPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();
    console.log("Platform initialized tx:", initTx);
  }

  console.log("Applying platform policy updates...");

  const baseParams: UpdatePlatformParams = {
    ...emptyUpdate(),
    feeBps,
    treasury,
    stakingTokenMint,
    defaultLienTimeoutSlots,
    forceResolutionFreelancerShareBps,
    minProviderStakeForAccept,
    minProviderAgeSlotsForAccept,
    minReputationJobAmount,
    disputeSlashingEnabled,
    disputeSlashBps,
    paused,
  };

  const baseUpdateTx = await program.methods
    .updatePlatformConfig(baseParams)
    .accounts({
      admin,
      platformConfig: platformConfigPda,
    } as any)
    .rpc();
  console.log("Base config updated tx:", baseUpdateTx);

  for (const arbiter of arbiters) {
    const tx = await program.methods
      .updatePlatformConfig({
        ...emptyUpdate(),
        addArbiter: arbiter,
      })
      .accounts({
        admin,
        platformConfig: platformConfigPda,
      } as any)
      .rpc();
    console.log("Added arbiter:", arbiter.toBase58(), "tx:", tx);
  }

  for (const paymentMint of paymentMints) {
    const tx = await program.methods
      .updatePlatformConfig({
        ...emptyUpdate(),
        addPaymentMint: paymentMint,
      })
      .accounts({
        admin,
        platformConfig: platformConfigPda,
      } as any)
      .rpc();
    console.log("Added payment mint:", paymentMint.toBase58(), "tx:", tx);
  }

  const config = await program.account.platformConfig.fetch(platformConfigPda);
  console.log("Final platform config:");
  console.log("  Admin:", config.admin.toBase58());
  console.log("  Fee BPS:", config.feeBps);
  console.log("  Treasury:", config.treasury.toBase58());
  console.log("  Staking Token Mint:", config.stakingTokenMint.toBase58());
  console.log(
    "  Allowed Payment Mints:",
    config.allowedPaymentMints.map((m: PublicKey) => m.toBase58()),
  );
  console.log("  Arbiters:", config.arbiters.map((a: PublicKey) => a.toBase58()));
  console.log("  Force Resolution Share BPS:", config.forceResolutionFreelancerShareBps);
  console.log("  Min Provider Stake For Accept:", config.minProviderStakeForAccept.toString());
  console.log("  Min Provider Age Slots For Accept:", config.minProviderAgeSlotsForAccept.toString());
  console.log("  Min Reputation Job Amount:", config.minReputationJobAmount.toString());
  console.log("  Dispute Slashing Enabled:", config.disputeSlashingEnabled);
  console.log("  Dispute Slash BPS:", config.disputeSlashBps);
  console.log("  Paused:", config.paused);
};
