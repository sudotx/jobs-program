import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";

import { FreelanceEscrow } from "../target/types/freelance_escrow";
import { expectBnEq, expectJobStatus } from "./helpers/assertions";
import {
  createAndFundWallet,
  initializePlatform,
  registerProvider,
  createJob,
  acceptJob,
} from "./helpers/setup";
import {
  getClientAccountPDA,
  getPlatformConfigPDA,
  getProviderPDA,
  getStakePDA,
} from "./helpers/pda";

const MIN_EXPIRY_SLOTS = 9_000;

describe("freelance_escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.freelanceEscrow as Program<FreelanceEscrow>;

  async function expectIxError(promise: Promise<unknown>, code?: string): Promise<void> {
    let failed = false;
    try {
      await promise;
    } catch (err: any) {
      failed = true;
      if (code) {
        const raw = [err?.message, JSON.stringify(err), JSON.stringify(err?.error)].join(" ");
        expect(raw).to.contain(code);
      }
    }
    expect(failed).to.equal(true);
  }

  async function tickSlots(count = 2): Promise<void> {
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

  async function warpToSlot(slot: number): Promise<boolean> {
    const conn = provider.connection as any;
    const methods = ["warp_slot", "warpSlot"];

    for (const method of methods) {
      try {
        const response = await conn._rpcRequest(method, [slot]);
        if (!response?.error) {
          return true;
        }
      } catch {
        // try the next extension method
      }
    }
    return false;
  }

  it("initializes platform, registers provider, and creates multiple jobs with incrementing nonces", async () => {
    const admin = await createAndFundWallet(provider, 10);
    const treasury = await createAndFundWallet(provider, 2);
    const client = await createAndFundWallet(provider, 10);

    await initializePlatform(program, admin, 250, treasury.publicKey, 20);

    const freelancer = await createAndFundWallet(provider, 10);
    await registerProvider(program, freelancer);

    const job1 = await createJob(program, client, 1, MIN_EXPIRY_SLOTS + 10);
    const job2 = await createJob(program, client, 10_000_000, MIN_EXPIRY_SLOTS + 20);

    expect(job1.nonce).to.equal(0);
    expect(job2.nonce).to.equal(1);

    const job1Account = await program.account.jobAccount.fetch(job1.pda);
    expectJobStatus(job1Account, "open");
    expectBnEq(job1Account.amount, 1);
    expect(job1Account.freelancer.toBase58()).to.equal(anchor.web3.PublicKey.default.toBase58());
    expect(job1Account.feeBpsSnapshot).to.equal(250);

    const [clientAccountPda] = getClientAccountPDA(program.programId, client.publicKey);
    const clientAccount = await program.account.clientAccount.fetch(clientAccountPda);
    expectBnEq(clientAccount.jobNonce, 2);
    expectBnEq(clientAccount.totalJobsCreated, 2);
  });

  it("blocks job creation when platform is paused", async () => {
    const admin = await createAndFundWallet(provider, 10);
    const treasury = await createAndFundWallet(provider, 2);
    const client = await createAndFundWallet(provider, 10);

    await initializePlatform(program, admin, 250, treasury.publicKey, 20);

    const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
    await program.methods
      .updatePlatformConfig({
        feeBps: null,
        treasury: null,
        addArbiter: null,
        removeArbiter: null,
        defaultLienTimeoutSlots: null,
        paused: true,
      })
      .accounts({
        admin: admin.publicKey,
        platformConfig,
      })
      .signers([admin])
      .rpc();

    await expectIxError(
      createJob(program, client, LAMPORTS_PER_SOL / 10, MIN_EXPIRY_SLOTS + 10),
      "PlatformPaused",
    );
  });

  it("requires provider registration before accepting a job", async () => {
    const admin = await createAndFundWallet(provider, 10);
    const treasury = await createAndFundWallet(provider, 2);
    const client = await createAndFundWallet(provider, 10);
    const freelancer = await createAndFundWallet(provider, 10);

    await initializePlatform(program, admin, 250, treasury.publicKey, 20);
    const { pda: jobPda } = await createJob(
      program,
      client,
      LAMPORTS_PER_SOL / 2,
      MIN_EXPIRY_SLOTS + 20,
    );

    await expectIxError(acceptJob(program, freelancer, jobPda), "AccountNotInitialized");

    await registerProvider(program, freelancer);
    await acceptJob(program, freelancer, jobPda);

    const jobAccount = await program.account.jobAccount.fetch(jobPda);
    expectJobStatus(jobAccount, "active");
    expect(jobAccount.freelancer.toBase58()).to.equal(freelancer.publicKey.toBase58());
  });

  it("completes an active job with correct fee and payout", async () => {
    const feeBps = 250;
    const amount = 2 * LAMPORTS_PER_SOL;

    const admin = await createAndFundWallet(provider, 10);
    const treasury = await createAndFundWallet(provider, 2);
    const client = await createAndFundWallet(provider, 10);
    const freelancer = await createAndFundWallet(provider, 10);

    await initializePlatform(program, admin, feeBps, treasury.publicKey, 20);
    await registerProvider(program, freelancer);

    const { pda: jobPda } = await createJob(program, client, amount, MIN_EXPIRY_SLOTS + 20);
    await acceptJob(program, freelancer, jobPda);

    const treasuryBefore = await provider.connection.getBalance(treasury.publicKey);
    const freelancerBefore = await provider.connection.getBalance(freelancer.publicKey);

    const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);

    await program.methods
      .completeJob()
      .accounts({
        jobAccount: jobPda,
        client: client.publicKey,
        freelancerWallet: freelancer.publicKey,
        providerAccount: providerPda,
        treasury: treasury.publicKey,
      })
      .signers([client])
      .rpc();

    const fee = Math.floor((amount * feeBps) / 10_000);
    const payout = amount - fee;

    const treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
    const freelancerAfter = await provider.connection.getBalance(freelancer.publicKey);

    expect(treasuryAfter - treasuryBefore).to.equal(fee);
    expect(freelancerAfter - freelancerBefore).to.equal(payout);

    const jobAfter = await program.account.jobAccount.fetchNullable(jobPda);
    expect(jobAfter).to.equal(null);

    const providerAfter = await program.account.providerAccount.fetch(providerPda);
    expectBnEq(providerAfter.totalJobsCompleted, 1);
    expect(providerAfter.reputationScore.toNumber()).to.equal(100);
  });

  it("cancels open jobs and blocks cancelling while lien is active", async () => {
    const admin = await createAndFundWallet(provider, 10);
    const treasury = await createAndFundWallet(provider, 2);
    const client = await createAndFundWallet(provider, 10);
    const freelancer = await createAndFundWallet(provider, 10);
    const arbiter = await createAndFundWallet(provider, 5);

    await initializePlatform(program, admin, 250, treasury.publicKey, 20);
    await registerProvider(program, freelancer);

    const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
    await program.methods
      .updatePlatformConfig({
        feeBps: null,
        treasury: null,
        addArbiter: arbiter.publicKey,
        removeArbiter: null,
        defaultLienTimeoutSlots: null,
        paused: null,
      })
      .accounts({ admin: admin.publicKey, platformConfig })
      .signers([admin])
      .rpc();

    const { pda: openJob } = await createJob(
      program,
      client,
      LAMPORTS_PER_SOL / 10,
      MIN_EXPIRY_SLOTS + 10,
    );
    await program.methods
      .cancelJob()
      .accounts({ jobAccount: openJob, client: client.publicKey })
      .signers([client])
      .rpc();

    const openJobAfter = await program.account.jobAccount.fetchNullable(openJob);
    expect(openJobAfter).to.equal(null);

    const { pda: lienJob } = await createJob(
      program,
      client,
      LAMPORTS_PER_SOL / 10,
      MIN_EXPIRY_SLOTS + 20,
    );
    await acceptJob(program, freelancer, lienJob);

    await program.methods
      .initiateLien()
      .accounts({
        signer: client.publicKey,
        jobAccount: lienJob,
        platformConfig,
      })
      .signers([client])
      .rpc();

    await expectIxError(
      program.methods
        .cancelJob()
        .accounts({ jobAccount: lienJob, client: client.publicKey })
        .signers([client])
        .rpc(),
      "CannotCancelDuringLien",
    );
  });

  it("resolves lien by arbiter and updates provider dispute counters", async () => {
    const feeBps = 250;
    const amount = 3 * LAMPORTS_PER_SOL;

    const admin = await createAndFundWallet(provider, 10);
    const treasury = await createAndFundWallet(provider, 2);
    const client = await createAndFundWallet(provider, 10);
    const freelancer = await createAndFundWallet(provider, 10);
    const arbiter = await createAndFundWallet(provider, 5);

    await initializePlatform(program, admin, feeBps, treasury.publicKey, 20);
    await registerProvider(program, freelancer);

    const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
    await program.methods
      .updatePlatformConfig({
        feeBps: null,
        treasury: null,
        addArbiter: arbiter.publicKey,
        removeArbiter: null,
        defaultLienTimeoutSlots: null,
        paused: null,
      })
      .accounts({ admin: admin.publicKey, platformConfig })
      .signers([admin])
      .rpc();

    const { pda: jobPda } = await createJob(program, client, amount, MIN_EXPIRY_SLOTS + 20);
    await acceptJob(program, freelancer, jobPda);

    await program.methods
      .initiateLien()
      .accounts({
        signer: client.publicKey,
        jobAccount: jobPda,
        platformConfig,
      })
      .signers([client])
      .rpc();

    const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);
    const treasuryBefore = await provider.connection.getBalance(treasury.publicKey);
    const freelancerBefore = await provider.connection.getBalance(freelancer.publicKey);
    const clientBefore = await provider.connection.getBalance(client.publicKey);

    await program.methods
      .resolveLien({ freelancerShareBps: 4000 })
      .accounts({
        jobAccount: jobPda,
        arbiter: arbiter.publicKey,
        clientWallet: client.publicKey,
        freelancerWallet: freelancer.publicKey,
        providerAccount: providerPda,
        treasury: treasury.publicKey,
      })
      .signers([arbiter])
      .rpc();

    const freelancerGross = Math.floor((amount * 4000) / 10_000);
    const fee = Math.floor((freelancerGross * feeBps) / 10_000);
    const freelancerNet = freelancerGross - fee;
    const clientRefund = amount - freelancerGross;

    const treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
    const freelancerAfter = await provider.connection.getBalance(freelancer.publicKey);
    const clientAfter = await provider.connection.getBalance(client.publicKey);

    expect(treasuryAfter - treasuryBefore).to.equal(fee);
    expect(freelancerAfter - freelancerBefore).to.equal(freelancerNet);
    expect(clientAfter - clientBefore).to.be.greaterThan(clientRefund - 10_000_000);

    const providerAfter = await program.account.providerAccount.fetch(providerPda);
    expectBnEq(providerAfter.totalJobsDisputedLost, 1);
    expect(providerAfter.reputationScore.toNumber()).to.equal(-250);

    const jobAfter = await program.account.jobAccount.fetchNullable(jobPda);
    expect(jobAfter).to.equal(null);
  });

  it("supports mutual lien resolution and enforces dual-signature", async () => {
    const admin = await createAndFundWallet(provider, 10);
    const treasury = await createAndFundWallet(provider, 2);
    const client = await createAndFundWallet(provider, 10);
    const freelancer = await createAndFundWallet(provider, 10);
    const arbiter = await createAndFundWallet(provider, 5);

    await initializePlatform(program, admin, 250, treasury.publicKey, 20);
    await registerProvider(program, freelancer);

    const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
    await program.methods
      .updatePlatformConfig({
        feeBps: null,
        treasury: null,
        addArbiter: arbiter.publicKey,
        removeArbiter: null,
        defaultLienTimeoutSlots: null,
        paused: null,
      })
      .accounts({ admin: admin.publicKey, platformConfig })
      .signers([admin])
      .rpc();

    const { pda: jobPda } = await createJob(
      program,
      client,
      LAMPORTS_PER_SOL,
      MIN_EXPIRY_SLOTS + 20,
    );
    await acceptJob(program, freelancer, jobPda);

    await program.methods
      .initiateLien()
      .accounts({
        signer: freelancer.publicKey,
        jobAccount: jobPda,
        platformConfig,
      })
      .signers([freelancer])
      .rpc();

    const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);

    await expectIxError(
      program.methods
        .mutualResolveLien({ freelancerShareBps: 6000 })
        .accounts({
          jobAccount: jobPda,
          client: client.publicKey,
          freelancer: freelancer.publicKey,
          providerAccount: providerPda,
          treasury: treasury.publicKey,
        })
        .signers([client])
        .rpc(),
    );

    await program.methods
      .mutualResolveLien({ freelancerShareBps: 6000 })
      .accounts({
        jobAccount: jobPda,
        client: client.publicKey,
        freelancer: freelancer.publicKey,
        providerAccount: providerPda,
        treasury: treasury.publicKey,
      })
      .signers([client, freelancer])
      .rpc();

    const jobAfter = await program.account.jobAccount.fetchNullable(jobPda);
    expect(jobAfter).to.equal(null);
  });

  it("force resolves lien only after timeout", async () => {
    const admin = await createAndFundWallet(provider, 10);
    const treasury = await createAndFundWallet(provider, 2);
    const client = await createAndFundWallet(provider, 10);
    const freelancer = await createAndFundWallet(provider, 10);
    const arbiter = await createAndFundWallet(provider, 5);
    const crank = await createAndFundWallet(provider, 2);

    await initializePlatform(program, admin, 250, treasury.publicKey, 1);
    await registerProvider(program, freelancer);

    const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
    await program.methods
      .updatePlatformConfig({
        feeBps: null,
        treasury: null,
        addArbiter: arbiter.publicKey,
        removeArbiter: null,
        defaultLienTimeoutSlots: null,
        paused: null,
      })
      .accounts({ admin: admin.publicKey, platformConfig })
      .signers([admin])
      .rpc();

    const { pda: jobPda } = await createJob(
      program,
      client,
      LAMPORTS_PER_SOL,
      MIN_EXPIRY_SLOTS + 20,
    );
    await acceptJob(program, freelancer, jobPda);

    await program.methods
      .initiateLien()
      .accounts({
        signer: client.publicKey,
        jobAccount: jobPda,
        platformConfig,
      })
      .signers([client])
      .rpc();

    const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);

    await expectIxError(
      program.methods
        .forceResolveLien()
        .accounts({
          crank: crank.publicKey,
          jobAccount: jobPda,
          clientWallet: client.publicKey,
          freelancerWallet: freelancer.publicKey,
          providerAccount: providerPda,
          treasury: treasury.publicKey,
        })
        .signers([crank])
        .rpc(),
      "LienNotExpired",
    );

    await tickSlots(3);

    await program.methods
      .forceResolveLien()
      .accounts({
        crank: crank.publicKey,
        jobAccount: jobPda,
        clientWallet: client.publicKey,
        freelancerWallet: freelancer.publicKey,
        providerAccount: providerPda,
        treasury: treasury.publicKey,
      })
      .signers([crank])
      .rpc();

    const jobAfter = await program.account.jobAccount.fetchNullable(jobPda);
    expect(jobAfter).to.equal(null);
  });

  it("stakes on provider and enforces cooldown before unstake", async () => {
    const admin = await createAndFundWallet(provider, 10);
    const treasury = await createAndFundWallet(provider, 2);
    const staker = await createAndFundWallet(provider, 10);
    const freelancer = await createAndFundWallet(provider, 10);

    await initializePlatform(program, admin, 250, treasury.publicKey, 20);
    await registerProvider(program, freelancer);

    const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);
    const [stakePda] = getStakePDA(program.programId, staker.publicKey, freelancer.publicKey);

    const stakeAmount = LAMPORTS_PER_SOL;
    await program.methods
      .stakeOnProvider(new anchor.BN(stakeAmount))
      .accounts({
        staker: staker.publicKey,
        providerAccount: providerPda,
        stakingAccount: stakePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([staker])
      .rpc();

    const providerAfterStake = await program.account.providerAccount.fetch(providerPda);
    const stakeAfter = await program.account.stakingAccount.fetch(stakePda);

    expectBnEq(providerAfterStake.totalStaked, stakeAmount);
    expect(providerAfterStake.reputationScore.toNumber()).to.equal(1);
    expectBnEq(stakeAfter.amount, stakeAmount);

    await expectIxError(
      program.methods
        .unstakeFromProvider(new anchor.BN(stakeAmount / 2))
        .accounts({
          staker: staker.publicKey,
          stakingAccount: stakePda,
          providerAccount: providerPda,
        })
        .signers([staker])
        .rpc(),
      "StakeCooldownActive",
    );
  });

  it("unstakes full balance and closes staking account when slot warp is available", async function () {
    const admin = await createAndFundWallet(provider, 10);
    const treasury = await createAndFundWallet(provider, 2);
    const staker = await createAndFundWallet(provider, 10);
    const freelancer = await createAndFundWallet(provider, 10);

    await initializePlatform(program, admin, 250, treasury.publicKey, 20);
    await registerProvider(program, freelancer);

    const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);
    const [stakePda] = getStakePDA(program.programId, staker.publicKey, freelancer.publicKey);

    const stakeAmount = LAMPORTS_PER_SOL;
    await program.methods
      .stakeOnProvider(new anchor.BN(stakeAmount))
      .accounts({
        staker: staker.publicKey,
        providerAccount: providerPda,
        stakingAccount: stakePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([staker])
      .rpc();

    const currentSlot = await provider.connection.getSlot("confirmed");
    const warped = await warpToSlot(currentSlot + 20_000);
    if (!warped) {
      this.skip();
    }

    await program.methods
      .unstakeFromProvider(new anchor.BN(stakeAmount))
      .accounts({
        staker: staker.publicKey,
        stakingAccount: stakePda,
        providerAccount: providerPda,
      })
      .signers([staker])
      .rpc();

    const stakeAfter = await program.account.stakingAccount.fetchNullable(stakePda);
    expect(stakeAfter).to.equal(null);

    const providerAfter = await program.account.providerAccount.fetch(providerPda);
    expectBnEq(providerAfter.totalStaked, 0);
    expect(providerAfter.stakerCount).to.equal(0);
    expect(providerAfter.reputationScore.toNumber()).to.equal(0);
  });
});
