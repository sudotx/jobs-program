import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import { FreelanceEscrow } from "../target/types/freelance_escrow";
import { expectBnEq, expectIxError, expectJobStatus } from "./helpers/assertions";
import {
  MIN_EXPIRY_SLOTS,
  acceptJob,
  completeJob,
  completeMilestone,
  createAndFundWallet,
  createAta,
  createTestMint,
  createTokenJob,
  createTokenMilestoneJob,
  forceResolveLien,
  initializePlatform,
  initiateLien,
  mintTokens,
  registerProvider,
  resolveLien,
  stakeOnProvider,
  tickSlots,
  tokenBalance,
  updatePlatformConfig,
  warpToSlot,
} from "./helpers/setup";
import { getClientAccountPDA, getJobPDA, getProviderPDA } from "./helpers/pda";

const toBN = (value: number | bigint): anchor.BN => new anchor.BN(BigInt(value).toString());
const USDC_DECIMALS = 6;
const USDC = 10 ** USDC_DECIMALS;

describe("Feature: Token Payment Policy", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.freelanceEscrow as Program<FreelanceEscrow>;

  async function createLegacyJobShouldFail(
    platformConfig: PublicKey,
    client: Keypair,
  ): Promise<void> {
    const [clientAccount] = getClientAccountPDA(program.programId, client.publicKey);
    const existing = await program.account.clientAccount.fetchNullable(clientAccount);
    const nonce = existing ? Number(existing.jobNonce.toString()) : 0;
    const [jobAccount] = getJobPDA(program.programId, client.publicKey, nonce);
    const slot = await provider.connection.getSlot("confirmed");
    await expectIxError(
      program.methods
        .createJob({
          amount: toBN(1 * USDC),
          expirySlot: toBN(slot + MIN_EXPIRY_SLOTS + 25),
        })
        .accounts({
          client: client.publicKey,
          platformConfig,
          clientAccount,
          jobAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([client])
        .rpc(),
      "TokenPaymentRequired",
    );
  }

  it("enforces token-only job creation and payment mint allowlist", async () => {
    const admin = await createAndFundWallet(provider, 20);
    const treasury = await createAndFundWallet(provider, 20);
    const client = await createAndFundWallet(provider, 20);
    const platformConfig = await initializePlatform(program, admin, 250, treasury.publicKey, 20);

    await createLegacyJobShouldFail(platformConfig, client);

    const allowedMint = await createTestMint(provider, admin, USDC_DECIMALS);
    const blockedMint = await createTestMint(provider, admin, USDC_DECIMALS);
    const allowedClientAta = await createAta(provider, admin, allowedMint, client.publicKey);
    const blockedClientAta = await createAta(provider, admin, blockedMint, client.publicKey);
    await mintTokens(provider, admin, allowedMint, allowedClientAta, 20 * USDC);
    await mintTokens(provider, admin, blockedMint, blockedClientAta, 20 * USDC);

    await updatePlatformConfig(program, admin, platformConfig, {
      addPaymentMint: allowedMint,
    });

    const { jobPda } = await createTokenJob(
      program,
      platformConfig,
      client,
      allowedMint,
      allowedClientAta,
      2 * USDC,
    );
    const job = await program.account.jobAccount.fetch(jobPda);
    expect(job.paymentMint.toBase58()).to.equal(allowedMint.toBase58());
    expectJobStatus(job, "open");

    await expectIxError(
      createTokenJob(
        program,
        platformConfig,
        client,
        blockedMint,
        blockedClientAta,
        1 * USDC,
      ),
      "PaymentMintNotAllowed",
    );
  });

  it("prevents staking mint from being used as a payment mint", async () => {
    const admin = await createAndFundWallet(provider, 20);
    const treasury = await createAndFundWallet(provider, 20);
    const platformConfig = await initializePlatform(program, admin, 250, treasury.publicKey, 20);

    const protocolMint = await createTestMint(provider, admin, USDC_DECIMALS);
    const stableMint = await createTestMint(provider, admin, USDC_DECIMALS);

    await updatePlatformConfig(program, admin, platformConfig, {
      stakingTokenMint: protocolMint,
    });

    await expectIxError(
      updatePlatformConfig(program, admin, platformConfig, {
        addPaymentMint: protocolMint,
      }),
      "PaymentMintConflictsWithStakingMint",
    );

    await updatePlatformConfig(program, admin, platformConfig, {
      addPaymentMint: stableMint,
    });
    await expectIxError(
      updatePlatformConfig(program, admin, platformConfig, {
        stakingTokenMint: stableMint,
      }),
      "PaymentMintConflictsWithStakingMint",
    );
  });
});

describe("Feature: Milestone Escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.freelanceEscrow as Program<FreelanceEscrow>;

  it("supports token milestone creation and release-by-milestone settlement", async () => {
    const admin = await createAndFundWallet(provider, 20);
    const treasury = await createAndFundWallet(provider, 20);
    const client = await createAndFundWallet(provider, 20);
    const freelancer = await createAndFundWallet(provider, 20);

    const platformConfig = await initializePlatform(program, admin, 250, treasury.publicKey, 20);
    await registerProvider(program, platformConfig, freelancer);

    const paymentMint = await createTestMint(provider, admin, USDC_DECIMALS);
    await updatePlatformConfig(program, admin, platformConfig, { addPaymentMint: paymentMint });

    const clientPaymentAta = await createAta(provider, admin, paymentMint, client.publicKey);
    const freelancerPaymentAta = await createAta(provider, admin, paymentMint, freelancer.publicKey);
    const treasuryPaymentAta = await createAta(provider, admin, paymentMint, treasury.publicKey);
    await mintTokens(provider, admin, paymentMint, clientPaymentAta, 20 * USDC);

    const milestoneAmounts = [1 * USDC, 2 * USDC];
    const { jobPda, tokenVault } = await createTokenMilestoneJob(
      program,
      platformConfig,
      client,
      paymentMint,
      clientPaymentAta,
      milestoneAmounts,
    );
    await acceptJob(program, platformConfig, freelancer, jobPda);

    await completeMilestone(
      program,
      platformConfig,
      client,
      freelancer.publicKey,
      jobPda,
      treasury.publicKey,
      tokenVault,
      freelancerPaymentAta,
      treasuryPaymentAta,
    );

    const afterFirst = await program.account.jobAccount.fetch(jobPda);
    expectBnEq(afterFirst.amount, 2 * USDC);
    expectBnEq(afterFirst.nextMilestoneIndex, 1);
    expectJobStatus(afterFirst, "active");

    await completeMilestone(
      program,
      platformConfig,
      client,
      freelancer.publicKey,
      jobPda,
      treasury.publicKey,
      tokenVault,
      freelancerPaymentAta,
      treasuryPaymentAta,
    );

    const closed = await program.account.jobAccount.fetchNullable(jobPda);
    expect(closed).to.equal(null);

    const freelancerBalance = await tokenBalance(provider, freelancerPaymentAta);
    const treasuryBalance = await tokenBalance(provider, treasuryPaymentAta);
    expect(freelancerBalance).to.equal(BigInt(2_925_000));
    expect(treasuryBalance).to.equal(BigInt(75_000));
  });
});

describe("Feature: Pause and Self-Accept Guards", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.freelanceEscrow as Program<FreelanceEscrow>;

  it("applies pause semantics to accept and stake mutating flows", async () => {
    const admin = await createAndFundWallet(provider, 20);
    const treasury = await createAndFundWallet(provider, 20);
    const client = await createAndFundWallet(provider, 20);
    const freelancer = await createAndFundWallet(provider, 20);

    const platformConfig = await initializePlatform(program, admin, 250, treasury.publicKey, 20);
    await registerProvider(program, platformConfig, freelancer);

    const paymentMint = await createTestMint(provider, admin, USDC_DECIMALS);
    const protocolMint = await createTestMint(provider, admin, USDC_DECIMALS);
    const clientPaymentAta = await createAta(provider, admin, paymentMint, client.publicKey);
    const freelancerStakeAta = await createAta(provider, admin, protocolMint, freelancer.publicKey);
    await mintTokens(provider, admin, paymentMint, clientPaymentAta, 10 * USDC);
    await mintTokens(provider, admin, protocolMint, freelancerStakeAta, 10 * USDC);

    await updatePlatformConfig(program, admin, platformConfig, {
      addPaymentMint: paymentMint,
      stakingTokenMint: protocolMint,
    });

    const { jobPda } = await createTokenJob(
      program,
      platformConfig,
      client,
      paymentMint,
      clientPaymentAta,
      1 * USDC,
    );

    await updatePlatformConfig(program, admin, platformConfig, { paused: true });

    await expectIxError(
      acceptJob(program, platformConfig, freelancer, jobPda),
      "PlatformPaused",
    );

    await expectIxError(
      stakeOnProvider(
        program,
        platformConfig,
        freelancer,
        freelancer.publicKey,
        protocolMint,
        freelancerStakeAta,
        1 * USDC,
      ),
      "PlatformPaused",
    );
  });

  it("blocks self-accept for creator-owned jobs", async () => {
    const admin = await createAndFundWallet(provider, 20);
    const treasury = await createAndFundWallet(provider, 20);
    const client = await createAndFundWallet(provider, 20);
    const platformConfig = await initializePlatform(program, admin, 250, treasury.publicKey, 20);
    await registerProvider(program, platformConfig, client);

    const paymentMint = await createTestMint(provider, admin, USDC_DECIMALS);
    const clientPaymentAta = await createAta(provider, admin, paymentMint, client.publicKey);
    await mintTokens(provider, admin, paymentMint, clientPaymentAta, 5 * USDC);
    await updatePlatformConfig(program, admin, platformConfig, { addPaymentMint: paymentMint });

    const { jobPda } = await createTokenJob(
      program,
      platformConfig,
      client,
      paymentMint,
      clientPaymentAta,
      1 * USDC,
    );

    await expectIxError(
      acceptJob(program, platformConfig, client, jobPda),
      "SelfAcceptNotAllowed",
    );
  });
});

describe("Feature: Policy-Driven Lien Resolution and Slashing", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.freelanceEscrow as Program<FreelanceEscrow>;

  it("uses configured forced-resolution share policy (not fixed split)", async () => {
    const feeBps = 200;
    const amount = 10 * USDC;
    const admin = await createAndFundWallet(provider, 20);
    const treasury = await createAndFundWallet(provider, 20);
    const client = await createAndFundWallet(provider, 20);
    const freelancer = await createAndFundWallet(provider, 20);
    const arbiter = await createAndFundWallet(provider, 20);
    const crank = await createAndFundWallet(provider, 20);

    const platformConfig = await initializePlatform(program, admin, feeBps, treasury.publicKey, 1);
    await registerProvider(program, platformConfig, freelancer);

    const paymentMint = await createTestMint(provider, admin, USDC_DECIMALS);
    const clientPaymentAta = await createAta(provider, admin, paymentMint, client.publicKey);
    const freelancerPaymentAta = await createAta(provider, admin, paymentMint, freelancer.publicKey);
    const treasuryPaymentAta = await createAta(provider, admin, paymentMint, treasury.publicKey);
    await mintTokens(provider, admin, paymentMint, clientPaymentAta, 50 * USDC);

    await updatePlatformConfig(program, admin, platformConfig, {
      addPaymentMint: paymentMint,
      addArbiter: arbiter.publicKey,
      forceResolutionFreelancerShareBps: 7000,
    });

    const { jobPda, tokenVault } = await createTokenJob(
      program,
      platformConfig,
      client,
      paymentMint,
      clientPaymentAta,
      amount,
    );
    await acceptJob(program, platformConfig, freelancer, jobPda);
    await initiateLien(program, platformConfig, client, jobPda);

    await tickSlots(provider, 3);

    const freelancerBefore = await tokenBalance(provider, freelancerPaymentAta);
    const clientBefore = await tokenBalance(provider, clientPaymentAta);
    const treasuryBefore = await tokenBalance(provider, treasuryPaymentAta);

    await forceResolveLien(
      program,
      platformConfig,
      crank,
      jobPda,
      client.publicKey,
      freelancer.publicKey,
      treasury.publicKey,
      tokenVault,
      clientPaymentAta,
      freelancerPaymentAta,
      treasuryPaymentAta,
    );

    const freelancerAfter = await tokenBalance(provider, freelancerPaymentAta);
    const clientAfter = await tokenBalance(provider, clientPaymentAta);
    const treasuryAfter = await tokenBalance(provider, treasuryPaymentAta);

    const freelancerGross = (amount * 7000) / 10_000;
    const fee = Math.floor((freelancerGross * feeBps) / 10_000);
    const freelancerNet = freelancerGross - fee;
    const clientRefund = amount - freelancerGross;

    expect(freelancerAfter - freelancerBefore).to.equal(BigInt(freelancerNet));
    expect(clientAfter - clientBefore).to.equal(BigInt(clientRefund));
    expect(treasuryAfter - treasuryBefore).to.equal(BigInt(fee));
  });

  it("applies slashing only for reputation-eligible dispute outcomes", async () => {
    const admin = await createAndFundWallet(provider, 30);
    const treasury = await createAndFundWallet(provider, 20);
    const client = await createAndFundWallet(provider, 20);
    const freelancer = await createAndFundWallet(provider, 20);
    const arbiter = await createAndFundWallet(provider, 20);

    const platformConfig = await initializePlatform(program, admin, 250, treasury.publicKey, 20);
    await registerProvider(program, platformConfig, freelancer);

    const paymentMint = await createTestMint(provider, admin, USDC_DECIMALS);
    const stakingMint = await createTestMint(provider, admin, USDC_DECIMALS);
    const clientPaymentAta = await createAta(provider, admin, paymentMint, client.publicKey);
    const freelancerStakingAta = await createAta(provider, admin, stakingMint, freelancer.publicKey);
    const freelancerPaymentAta = await createAta(provider, admin, paymentMint, freelancer.publicKey);
    const treasuryPaymentAta = await createAta(provider, admin, paymentMint, treasury.publicKey);
    await mintTokens(provider, admin, paymentMint, clientPaymentAta, 100 * USDC);
    await mintTokens(provider, admin, stakingMint, freelancerStakingAta, 20 * USDC);

    await updatePlatformConfig(program, admin, platformConfig, {
      addArbiter: arbiter.publicKey,
      addPaymentMint: paymentMint,
      stakingTokenMint: stakingMint,
      minReputationJobAmount: toBN(2 * USDC),
      disputeSlashingEnabled: true,
      disputeSlashBps: 1000,
    });

    await stakeOnProvider(
      program,
      platformConfig,
      freelancer,
      freelancer.publicKey,
      stakingMint,
      freelancerStakingAta,
      10 * USDC,
    );

    const lowJob = await createTokenJob(
      program,
      platformConfig,
      client,
      paymentMint,
      clientPaymentAta,
      1 * USDC,
    );
    await acceptJob(program, platformConfig, freelancer, lowJob.jobPda);
    await initiateLien(program, platformConfig, client, lowJob.jobPda);
    await resolveLien(
      program,
      platformConfig,
      arbiter,
      lowJob.jobPda,
      client.publicKey,
      freelancer.publicKey,
      treasury.publicKey,
      lowJob.tokenVault,
      clientPaymentAta,
      freelancerPaymentAta,
      treasuryPaymentAta,
      4_000,
    );

    const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);
    const afterLow = await program.account.providerAccount.fetch(providerPda);
    expectBnEq(afterLow.totalJobsDisputedLost, 0);
    expectBnEq(afterLow.totalStaked, 10 * USDC);

    const highJob = await createTokenJob(
      program,
      platformConfig,
      client,
      paymentMint,
      clientPaymentAta,
      3 * USDC,
    );
    await acceptJob(program, platformConfig, freelancer, highJob.jobPda);
    await initiateLien(program, platformConfig, client, highJob.jobPda);
    await resolveLien(
      program,
      platformConfig,
      arbiter,
      highJob.jobPda,
      client.publicKey,
      freelancer.publicKey,
      treasury.publicKey,
      highJob.tokenVault,
      clientPaymentAta,
      freelancerPaymentAta,
      treasuryPaymentAta,
      4_000,
    );

    const afterHigh = await program.account.providerAccount.fetch(providerPda);
    expectBnEq(afterHigh.totalJobsDisputedLost, 1);
    expectBnEq(afterHigh.totalStaked, 9 * USDC);
  });
});

describe("Feature: Anti-Sybil and Reputation Weighting", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.freelanceEscrow as Program<FreelanceEscrow>;

  it("enforces min provider stake and provider age before accepting jobs", async () => {
    const admin = await createAndFundWallet(provider, 30);
    const treasury = await createAndFundWallet(provider, 20);
    const client = await createAndFundWallet(provider, 20);
    const freelancer = await createAndFundWallet(provider, 20);

    const platformConfig = await initializePlatform(program, admin, 250, treasury.publicKey, 20);
    await registerProvider(program, platformConfig, freelancer);

    const paymentMint = await createTestMint(provider, admin, USDC_DECIMALS);
    const stakingMint = await createTestMint(provider, admin, USDC_DECIMALS);
    const clientPaymentAta = await createAta(provider, admin, paymentMint, client.publicKey);
    const freelancerStakingAta = await createAta(provider, admin, stakingMint, freelancer.publicKey);
    await mintTokens(provider, admin, paymentMint, clientPaymentAta, 20 * USDC);
    await mintTokens(provider, admin, stakingMint, freelancerStakingAta, 20 * USDC);

    await updatePlatformConfig(program, admin, platformConfig, {
      addPaymentMint: paymentMint,
      stakingTokenMint: stakingMint,
      minProviderStakeForAccept: toBN(2 * USDC),
      minProviderAgeSlotsForAccept: toBN(50),
    });

    const { jobPda } = await createTokenJob(
      program,
      platformConfig,
      client,
      paymentMint,
      clientPaymentAta,
      1 * USDC,
    );

    await expectIxError(
      acceptJob(program, platformConfig, freelancer, jobPda),
      "InsufficientStakeForJobAcceptance",
    );

    await stakeOnProvider(
      program,
      platformConfig,
      freelancer,
      freelancer.publicKey,
      stakingMint,
      freelancerStakingAta,
      2 * USDC,
    );

    await expectIxError(
      acceptJob(program, platformConfig, freelancer, jobPda),
      "ProviderTooNewForJobAcceptance",
    );

    const currentSlot = await provider.connection.getSlot("confirmed");
    const warped = await warpToSlot(provider, currentSlot + 60);
    if (!warped) {
      await tickSlots(provider, 60);
    }

    await acceptJob(program, platformConfig, freelancer, jobPda);
    const job = await program.account.jobAccount.fetch(jobPda);
    expectJobStatus(job, "active");
  });

  it("applies confidence-weighted reputation growth for low-volume providers", async () => {
    const admin = await createAndFundWallet(provider, 20);
    const treasury = await createAndFundWallet(provider, 20);
    const client = await createAndFundWallet(provider, 20);
    const freelancer = await createAndFundWallet(provider, 20);

    const platformConfig = await initializePlatform(program, admin, 250, treasury.publicKey, 20);
    await registerProvider(program, platformConfig, freelancer);

    const paymentMint = await createTestMint(provider, admin, USDC_DECIMALS);
    const clientPaymentAta = await createAta(provider, admin, paymentMint, client.publicKey);
    const freelancerPaymentAta = await createAta(provider, admin, paymentMint, freelancer.publicKey);
    const treasuryPaymentAta = await createAta(provider, admin, paymentMint, treasury.publicKey);
    await mintTokens(provider, admin, paymentMint, clientPaymentAta, 10 * USDC);

    await updatePlatformConfig(program, admin, platformConfig, {
      addPaymentMint: paymentMint,
      minReputationJobAmount: toBN(1),
    });

    const { jobPda, tokenVault } = await createTokenJob(
      program,
      platformConfig,
      client,
      paymentMint,
      clientPaymentAta,
      1 * USDC,
    );
    await acceptJob(program, platformConfig, freelancer, jobPda);
    await completeJob(
      program,
      platformConfig,
      client,
      freelancer.publicKey,
      jobPda,
      treasury.publicKey,
      tokenVault,
      freelancerPaymentAta,
      treasuryPaymentAta,
    );

    const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);
    const providerAfter = await program.account.providerAccount.fetch(providerPda);
    expectBnEq(providerAfter.totalJobsCompleted, 1);
    expect(providerAfter.reputationScore.toString()).to.equal("11");
  });
});
