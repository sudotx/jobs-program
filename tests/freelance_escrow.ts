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
    console.log("client", client.publicKey);
    const freelancer = await createAndFundWallet(provider, 10);

    await initializePlatform(program, admin, 250, treasury.publicKey, 20);
    await registerProvider(program, freelancer);

    const job1 = await createJob(program, client, 1, MIN_EXPIRY_SLOTS + 10);
    console.log({ job1 });
    const job2 = await createJob(program, client, 10_000_000, MIN_EXPIRY_SLOTS + 20);
    console.log({ job2 });

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

  // it("blocks job creation when platform is paused", async () => {
  //   const admin = await createAndFundWallet(provider, 10);
  //   const treasury = await createAndFundWallet(provider, 2);
  //   const client = await createAndFundWallet(provider, 10);

  //   await initializePlatform(program, admin, 250, treasury.publicKey, 20);

  //   const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  //   await program.methods
  //     .updatePlatformConfig({
  //       feeBps: null,
  //       treasury: null,
  //       addArbiter: null,
  //       removeArbiter: null,
  //       defaultLienTimeoutSlots: null,
  //       paused: true,
  //     })
  //     .accounts({
  //       admin: admin.publicKey,
  //       platformConfig,
  //     })
  //     .signers([admin])
  //     .rpc();

  //   await expectIxError(
  //     createJob(program, client, LAMPORTS_PER_SOL / 10, MIN_EXPIRY_SLOTS + 10),
  //     "PlatformPaused",
  //   );
  // });

  // it("requires provider registration before accepting a job", async () => {
  //   const admin = await createAndFundWallet(provider, 10);
  //   const treasury = await createAndFundWallet(provider, 2);
  //   const client = await createAndFundWallet(provider, 10);
  //   const freelancer = await createAndFundWallet(provider, 10);

  //   await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //   const { pda: jobPda } = await createJob(
  //     program,
  //     client,
  //     LAMPORTS_PER_SOL / 2,
  //     MIN_EXPIRY_SLOTS + 20,
  //   );

  //   await expectIxError(acceptJob(program, freelancer, jobPda), "AccountNotInitialized");

  //   await registerProvider(program, freelancer);
  //   await acceptJob(program, freelancer, jobPda);

  //   const jobAccount = await program.account.jobAccount.fetch(jobPda);
  //   expectJobStatus(jobAccount, "active");
  //   expect(jobAccount.freelancer.toBase58()).to.equal(freelancer.publicKey.toBase58());
  // });

  // it("completes an active job with correct fee and payout", async () => {
  //   const feeBps = 250;
  //   const amount = 2 * LAMPORTS_PER_SOL;

  //   const admin = await createAndFundWallet(provider, 10);
  //   const treasury = await createAndFundWallet(provider, 2);
  //   const client = await createAndFundWallet(provider, 10);
  //   const freelancer = await createAndFundWallet(provider, 10);

  //   await initializePlatform(program, admin, feeBps, treasury.publicKey, 20);
  //   await registerProvider(program, freelancer);

  //   const { pda: jobPda } = await createJob(program, client, amount, MIN_EXPIRY_SLOTS + 20);
  //   await acceptJob(program, freelancer, jobPda);

  //   const treasuryBefore = await provider.connection.getBalance(treasury.publicKey);
  //   const freelancerBefore = await provider.connection.getBalance(freelancer.publicKey);

  //   const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);

  //   await program.methods
  //     .completeJob()
  //     .accounts({
  //       jobAccount: jobPda,
  //       client: client.publicKey,
  //       freelancerWallet: freelancer.publicKey,
  //       providerAccount: providerPda,
  //       treasury: treasury.publicKey,
  //     })
  //     .signers([client])
  //     .rpc();

  //   const fee = Math.floor((amount * feeBps) / 10_000);
  //   const payout = amount - fee;

  //   const treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
  //   const freelancerAfter = await provider.connection.getBalance(freelancer.publicKey);

  //   expect(treasuryAfter - treasuryBefore).to.equal(fee);
  //   expect(freelancerAfter - freelancerBefore).to.equal(payout);

  //   const jobAfter = await program.account.jobAccount.fetchNullable(jobPda);
  //   expect(jobAfter).to.equal(null);

  //   const providerAfter = await program.account.providerAccount.fetch(providerPda);
  //   expectBnEq(providerAfter.totalJobsCompleted, 1);
  //   expect(providerAfter.reputationScore.toNumber()).to.equal(100);
  // });

  // it("cancels open jobs and blocks cancelling while lien is active", async () => {
  //   const admin = await createAndFundWallet(provider, 10);
  //   const treasury = await createAndFundWallet(provider, 2);
  //   const client = await createAndFundWallet(provider, 10);
  //   const freelancer = await createAndFundWallet(provider, 10);
  //   const arbiter = await createAndFundWallet(provider, 5);

  //   await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //   await registerProvider(program, freelancer);

  //   const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  //   await program.methods
  //     .updatePlatformConfig({
  //       feeBps: null,
  //       treasury: null,
  //       addArbiter: arbiter.publicKey,
  //       removeArbiter: null,
  //       defaultLienTimeoutSlots: null,
  //       paused: null,
  //     })
  //     .accounts({ admin: admin.publicKey, platformConfig })
  //     .signers([admin])
  //     .rpc();

  //   const { pda: openJob } = await createJob(
  //     program,
  //     client,
  //     LAMPORTS_PER_SOL / 10,
  //     MIN_EXPIRY_SLOTS + 10,
  //   );
  //   await program.methods
  //     .cancelJob()
  //     .accounts({ jobAccount: openJob, client: client.publicKey })
  //     .signers([client])
  //     .rpc();

  //   const openJobAfter = await program.account.jobAccount.fetchNullable(openJob);
  //   expect(openJobAfter).to.equal(null);

  //   const { pda: lienJob } = await createJob(
  //     program,
  //     client,
  //     LAMPORTS_PER_SOL / 10,
  //     MIN_EXPIRY_SLOTS + 20,
  //   );
  //   await acceptJob(program, freelancer, lienJob);

  //   await program.methods
  //     .initiateLien()
  //     .accounts({
  //       signer: client.publicKey,
  //       jobAccount: lienJob,
  //       platformConfig,
  //     })
  //     .signers([client])
  //     .rpc();

  //   await expectIxError(
  //     program.methods
  //       .cancelJob()
  //       .accounts({ jobAccount: lienJob, client: client.publicKey })
  //       .signers([client])
  //       .rpc(),
  //     "CannotCancelDuringLien",
  //   );
  // });

  // it("resolves lien by arbiter and updates provider dispute counters", async () => {
  //   const feeBps = 250;
  //   const amount = 3 * LAMPORTS_PER_SOL;

  //   const admin = await createAndFundWallet(provider, 10);
  //   const treasury = await createAndFundWallet(provider, 2);
  //   const client = await createAndFundWallet(provider, 10);
  //   const freelancer = await createAndFundWallet(provider, 10);
  //   const arbiter = await createAndFundWallet(provider, 5);

  //   await initializePlatform(program, admin, feeBps, treasury.publicKey, 20);
  //   await registerProvider(program, freelancer);

  //   const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  //   await program.methods
  //     .updatePlatformConfig({
  //       feeBps: null,
  //       treasury: null,
  //       addArbiter: arbiter.publicKey,
  //       removeArbiter: null,
  //       defaultLienTimeoutSlots: null,
  //       paused: null,
  //     })
  //     .accounts({ admin: admin.publicKey, platformConfig })
  //     .signers([admin])
  //     .rpc();

  //   const { pda: jobPda } = await createJob(program, client, amount, MIN_EXPIRY_SLOTS + 20);
  //   await acceptJob(program, freelancer, jobPda);

  //   await program.methods
  //     .initiateLien()
  //     .accounts({
  //       signer: client.publicKey,
  //       jobAccount: jobPda,
  //       platformConfig,
  //     })
  //     .signers([client])
  //     .rpc();

  //   const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);
  //   const treasuryBefore = await provider.connection.getBalance(treasury.publicKey);
  //   const freelancerBefore = await provider.connection.getBalance(freelancer.publicKey);
  //   const clientBefore = await provider.connection.getBalance(client.publicKey);

  //   await program.methods
  //     .resolveLien({ freelancerShareBps: 4000 })
  //     .accounts({
  //       jobAccount: jobPda,
  //       arbiter: arbiter.publicKey,
  //       clientWallet: client.publicKey,
  //       freelancerWallet: freelancer.publicKey,
  //       providerAccount: providerPda,
  //       treasury: treasury.publicKey,
  //     })
  //     .signers([arbiter])
  //     .rpc();

  //   const freelancerGross = Math.floor((amount * 4000) / 10_000);
  //   const fee = Math.floor((freelancerGross * feeBps) / 10_000);
  //   const freelancerNet = freelancerGross - fee;
  //   const clientRefund = amount - freelancerGross;

  //   const treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
  //   const freelancerAfter = await provider.connection.getBalance(freelancer.publicKey);
  //   const clientAfter = await provider.connection.getBalance(client.publicKey);

  //   expect(treasuryAfter - treasuryBefore).to.equal(fee);
  //   expect(freelancerAfter - freelancerBefore).to.equal(freelancerNet);
  //   expect(clientAfter - clientBefore).to.be.greaterThan(clientRefund - 10_000_000);

  //   const providerAfter = await program.account.providerAccount.fetch(providerPda);
  //   expectBnEq(providerAfter.totalJobsDisputedLost, 1);
  //   expect(providerAfter.reputationScore.toNumber()).to.equal(-250);

  //   const jobAfter = await program.account.jobAccount.fetchNullable(jobPda);
  //   expect(jobAfter).to.equal(null);
  // });

  // it("supports mutual lien resolution and enforces dual-signature", async () => {
  //   const admin = await createAndFundWallet(provider, 10);
  //   const treasury = await createAndFundWallet(provider, 2);
  //   const client = await createAndFundWallet(provider, 10);
  //   const freelancer = await createAndFundWallet(provider, 10);
  //   const arbiter = await createAndFundWallet(provider, 5);

  //   await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //   await registerProvider(program, freelancer);

  //   const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  //   await program.methods
  //     .updatePlatformConfig({
  //       feeBps: null,
  //       treasury: null,
  //       addArbiter: arbiter.publicKey,
  //       removeArbiter: null,
  //       defaultLienTimeoutSlots: null,
  //       paused: null,
  //     })
  //     .accounts({ admin: admin.publicKey, platformConfig })
  //     .signers([admin])
  //     .rpc();

  //   const { pda: jobPda } = await createJob(
  //     program,
  //     client,
  //     LAMPORTS_PER_SOL,
  //     MIN_EXPIRY_SLOTS + 20,
  //   );
  //   await acceptJob(program, freelancer, jobPda);

  //   await program.methods
  //     .initiateLien()
  //     .accounts({
  //       signer: freelancer.publicKey,
  //       jobAccount: jobPda,
  //       platformConfig,
  //     })
  //     .signers([freelancer])
  //     .rpc();

  //   const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);

  //   await expectIxError(
  //     program.methods
  //       .mutualResolveLien({ freelancerShareBps: 6000 })
  //       .accounts({
  //         jobAccount: jobPda,
  //         client: client.publicKey,
  //         freelancer: freelancer.publicKey,
  //         providerAccount: providerPda,
  //         treasury: treasury.publicKey,
  //       })
  //       .signers([client])
  //       .rpc(),
  //   );

  //   await program.methods
  //     .mutualResolveLien({ freelancerShareBps: 6000 })
  //     .accounts({
  //       jobAccount: jobPda,
  //       client: client.publicKey,
  //       freelancer: freelancer.publicKey,
  //       providerAccount: providerPda,
  //       treasury: treasury.publicKey,
  //     })
  //     .signers([client, freelancer])
  //     .rpc();

  //   const jobAfter = await program.account.jobAccount.fetchNullable(jobPda);
  //   expect(jobAfter).to.equal(null);
  // });

  // it("force resolves lien only after timeout", async () => {
  //   const admin = await createAndFundWallet(provider, 10);
  //   const treasury = await createAndFundWallet(provider, 2);
  //   const client = await createAndFundWallet(provider, 10);
  //   const freelancer = await createAndFundWallet(provider, 10);
  //   const arbiter = await createAndFundWallet(provider, 5);
  //   const crank = await createAndFundWallet(provider, 2);

  //   await initializePlatform(program, admin, 250, treasury.publicKey, 1);
  //   await registerProvider(program, freelancer);

  //   const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  //   await program.methods
  //     .updatePlatformConfig({
  //       feeBps: null,
  //       treasury: null,
  //       addArbiter: arbiter.publicKey,
  //       removeArbiter: null,
  //       defaultLienTimeoutSlots: null,
  //       paused: null,
  //     })
  //     .accounts({ admin: admin.publicKey, platformConfig })
  //     .signers([admin])
  //     .rpc();

  //   const { pda: jobPda } = await createJob(
  //     program,
  //     client,
  //     LAMPORTS_PER_SOL,
  //     MIN_EXPIRY_SLOTS + 20,
  //   );
  //   await acceptJob(program, freelancer, jobPda);

  //   await program.methods
  //     .initiateLien()
  //     .accounts({
  //       signer: client.publicKey,
  //       jobAccount: jobPda,
  //       platformConfig,
  //     })
  //     .signers([client])
  //     .rpc();

  //   const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);

  //   await expectIxError(
  //     program.methods
  //       .forceResolveLien()
  //       .accounts({
  //         crank: crank.publicKey,
  //         jobAccount: jobPda,
  //         clientWallet: client.publicKey,
  //         freelancerWallet: freelancer.publicKey,
  //         providerAccount: providerPda,
  //         treasury: treasury.publicKey,
  //       })
  //       .signers([crank])
  //       .rpc(),
  //     "LienNotExpired",
  //   );

  //   await tickSlots(3);

  //   await program.methods
  //     .forceResolveLien()
  //     .accounts({
  //       crank: crank.publicKey,
  //       jobAccount: jobPda,
  //       clientWallet: client.publicKey,
  //       freelancerWallet: freelancer.publicKey,
  //       providerAccount: providerPda,
  //       treasury: treasury.publicKey,
  //     })
  //     .signers([crank])
  //     .rpc();

  //   const jobAfter = await program.account.jobAccount.fetchNullable(jobPda);
  //   expect(jobAfter).to.equal(null);
  // });

  // it("stakes on provider and enforces cooldown before unstake", async () => {
  //   const admin = await createAndFundWallet(provider, 10);
  //   const treasury = await createAndFundWallet(provider, 2);
  //   const staker = await createAndFundWallet(provider, 10);
  //   const freelancer = await createAndFundWallet(provider, 10);

  //   await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //   await registerProvider(program, freelancer);

  //   const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);
  //   const [stakePda] = getStakePDA(program.programId, staker.publicKey, freelancer.publicKey);

  //   const stakeAmount = LAMPORTS_PER_SOL;
  //   await program.methods
  //     .stakeOnProvider(new anchor.BN(stakeAmount))
  //     .accounts({
  //       staker: staker.publicKey,
  //       providerAccount: providerPda,
  //       stakingAccount: stakePda,
  //       systemProgram: SystemProgram.programId,
  //     })
  //     .signers([staker])
  //     .rpc();

  //   const providerAfterStake = await program.account.providerAccount.fetch(providerPda);
  //   const stakeAfter = await program.account.stakingAccount.fetch(stakePda);

  //   expectBnEq(providerAfterStake.totalStaked, stakeAmount);
  //   expect(providerAfterStake.reputationScore.toNumber()).to.equal(1);
  //   expectBnEq(stakeAfter.amount, stakeAmount);

  //   await expectIxError(
  //     program.methods
  //       .unstakeFromProvider(new anchor.BN(stakeAmount / 2))
  //       .accounts({
  //         staker: staker.publicKey,
  //         stakingAccount: stakePda,
  //         providerAccount: providerPda,
  //       })
  //       .signers([staker])
  //       .rpc(),
  //     "StakeCooldownActive",
  //   );
  // });

  // it("unstakes full balance and closes staking account when slot warp is available", async function () {
  //   const admin = await createAndFundWallet(provider, 10);
  //   const treasury = await createAndFundWallet(provider, 2);
  //   const staker = await createAndFundWallet(provider, 10);
  //   const freelancer = await createAndFundWallet(provider, 10);

  //   await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //   await registerProvider(program, freelancer);

  //   const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);
  //   const [stakePda] = getStakePDA(program.programId, staker.publicKey, freelancer.publicKey);

  //   const stakeAmount = LAMPORTS_PER_SOL;
  //   await program.methods
  //     .stakeOnProvider(new anchor.BN(stakeAmount))
  //     .accounts({
  //       staker: staker.publicKey,
  //       providerAccount: providerPda,
  //       stakingAccount: stakePda,
  //       systemProgram: SystemProgram.programId,
  //     })
  //     .signers([staker])
  //     .rpc();

  //   const currentSlot = await provider.connection.getSlot("confirmed");
  //   const warped = await warpToSlot(currentSlot + 20_000);
  //   if (!warped) {
  //     this.skip();
  //   }

  //   await program.methods
  //     .unstakeFromProvider(new anchor.BN(stakeAmount))
  //     .accounts({
  //       staker: staker.publicKey,
  //       stakingAccount: stakePda,
  //       providerAccount: providerPda,
  //     })
  //     .signers([staker])
  //     .rpc();

  //   const stakeAfter = await program.account.stakingAccount.fetchNullable(stakePda);
  //   expect(stakeAfter).to.equal(null);

  //   const providerAfter = await program.account.providerAccount.fetch(providerPda);
  //   expectBnEq(providerAfter.totalStaked, 0);
  //   expect(providerAfter.stakerCount).to.equal(0);
  //   expect(providerAfter.reputationScore.toNumber()).to.equal(0);
  // });

  // ============================================================
  // ADVERSARIAL TESTS - Authorization
  // ============================================================

  // describe("Adversarial: Authorization", () => {
  //   it("blocks non-client from cancelling a job", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const attacker = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     const { pda: jobPda } = await createJob(program, client, LAMPORTS_PER_SOL, MIN_EXPIRY_SLOTS + 10);

  //     await expectIxError(
  //       program.methods
  //         .cancelJob()
  //         .accounts({ jobAccount: jobPda, client: attacker.publicKey })
  //         .signers([attacker])
  //         .rpc(),
  //       "UnauthorizedClient",
  //     );
  //   });

  //   it("blocks non-client from completing a job", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);
  //     const attacker = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     const { pda: jobPda } = await createJob(program, client, LAMPORTS_PER_SOL, MIN_EXPIRY_SLOTS + 20);
  //     await acceptJob(program, freelancer, jobPda);

  //     const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);

  //     await expectIxError(
  //       program.methods
  //         .completeJob()
  //         .accounts({
  //           jobAccount: jobPda,
  //           client: attacker.publicKey,
  //           freelancerWallet: freelancer.publicKey,
  //           providerAccount: providerPda,
  //           treasury: treasury.publicKey,
  //         })
  //         .signers([attacker])
  //         .rpc(),
  //       "UnauthorizedClient",
  //     );
  //   });

  //   it("blocks third party from initiating lien", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);
  //     const attacker = await createAndFundWallet(provider, 10);
  //     const arbiter = await createAndFundWallet(provider, 5);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  //     await program.methods
  //       .updatePlatformConfig({
  //         feeBps: null,
  //         treasury: null,
  //         addArbiter: arbiter.publicKey,
  //         removeArbiter: null,
  //         defaultLienTimeoutSlots: null,
  //         paused: null,
  //       })
  //       .accounts({ admin: admin.publicKey, platformConfig })
  //       .signers([admin])
  //       .rpc();

  //     const { pda: jobPda } = await createJob(program, client, LAMPORTS_PER_SOL, MIN_EXPIRY_SLOTS + 20);
  //     await acceptJob(program, freelancer, jobPda);

  //     await expectIxError(
  //       program.methods
  //         .initiateLien()
  //         .accounts({
  //           signer: attacker.publicKey,
  //           jobAccount: jobPda,
  //           platformConfig,
  //         })
  //         .signers([attacker])
  //         .rpc(),
  //       "UnauthorizedLienInitiator",
  //     );
  //   });

  //   it("blocks non-arbiter from resolving lien", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);
  //     const arbiter = await createAndFundWallet(provider, 5);
  //     const fakeArbiter = await createAndFundWallet(provider, 5);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  //     await program.methods
  //       .updatePlatformConfig({
  //         feeBps: null,
  //         treasury: null,
  //         addArbiter: arbiter.publicKey,
  //         removeArbiter: null,
  //         defaultLienTimeoutSlots: null,
  //         paused: null,
  //       })
  //       .accounts({ admin: admin.publicKey, platformConfig })
  //       .signers([admin])
  //       .rpc();

  //     const { pda: jobPda } = await createJob(program, client, LAMPORTS_PER_SOL, MIN_EXPIRY_SLOTS + 20);
  //     await acceptJob(program, freelancer, jobPda);

  //     await program.methods
  //       .initiateLien()
  //       .accounts({
  //         signer: client.publicKey,
  //         jobAccount: jobPda,
  //         platformConfig,
  //       })
  //       .signers([client])
  //       .rpc();

  //     const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);

  //     await expectIxError(
  //       program.methods
  //         .resolveLien({ freelancerShareBps: 5000 })
  //         .accounts({
  //           jobAccount: jobPda,
  //           arbiter: fakeArbiter.publicKey,
  //           clientWallet: client.publicKey,
  //           freelancerWallet: freelancer.publicKey,
  //           providerAccount: providerPda,
  //           treasury: treasury.publicKey,
  //         })
  //         .signers([fakeArbiter])
  //         .rpc(),
  //       "UnauthorizedArbiter",
  //     );
  //   });

  //   it("blocks non-admin from updating platform config", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const attacker = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);

  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);

  //     await expectIxError(
  //       program.methods
  //         .updatePlatformConfig({
  //           feeBps: 500,
  //           treasury: null,
  //           addArbiter: null,
  //           removeArbiter: null,
  //           defaultLienTimeoutSlots: null,
  //           paused: null,
  //         })
  //         .accounts({ admin: attacker.publicKey, platformConfig })
  //         .signers([attacker])
  //         .rpc(),
  //     );
  //   });

  //   it("blocks freelancer from accepting their own job as client", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const clientAndFreelancer = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     await registerProvider(program, clientAndFreelancer);

  //     const { pda: jobPda } = await createJob(
  //       program,
  //       clientAndFreelancer,
  //       LAMPORTS_PER_SOL,
  //       MIN_EXPIRY_SLOTS + 20,
  //     );

  //     // This should succeed - the program doesn't block self-acceptance
  //     // This is a potential business logic issue depending on requirements
  //     await acceptJob(program, clientAndFreelancer, jobPda);
  //     const jobAccount = await program.account.jobAccount.fetch(jobPda);
  //     expect(jobAccount.freelancer.toBase58()).to.equal(clientAndFreelancer.publicKey.toBase58());
  //   });
  // });

  // // ============================================================
  // // ADVERSARIAL TESTS - Input Validation
  // // ============================================================

  // describe("Adversarial: Input Validation", () => {
  //   it("blocks zero amount job creation", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);

  //     await expectIxError(createJob(program, client, 0, MIN_EXPIRY_SLOTS + 10), "InvalidAmount");
  //   });

  //   it("blocks job creation with expiry slot in the past", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);

  //     // MIN_EXPIRY_SLOTS - 1000 will be less than MIN_EXPIRY_SLOTS
  //     await expectIxError(createJob(program, client, LAMPORTS_PER_SOL, 100), "InvalidExpiry");
  //   });

  //   it("blocks job creation with expiry too close to current slot", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);

  //     await expectIxError(
  //       createJob(program, client, LAMPORTS_PER_SOL, MIN_EXPIRY_SLOTS - 1),
  //       "InvalidExpiry",
  //     );
  //   });

  //   it("blocks fee_bps > 1000 (10%)", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);

  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);

  //     await expectIxError(
  //       program.methods
  //         .updatePlatformConfig({
  //           feeBps: 1001,
  //           treasury: null,
  //           addArbiter: null,
  //           removeArbiter: null,
  //           defaultLienTimeoutSlots: null,
  //           paused: null,
  //         })
  //         .accounts({ admin: admin.publicKey, platformConfig })
  //         .signers([admin])
  //         .rpc(),
  //       "InvalidFeeBps",
  //     );
  //   });

  //   it("blocks freelancer_share_bps > 10000 in lien resolution", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);
  //     const arbiter = await createAndFundWallet(provider, 5);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  //     await program.methods
  //       .updatePlatformConfig({
  //         feeBps: null,
  //         treasury: null,
  //         addArbiter: arbiter.publicKey,
  //         removeArbiter: null,
  //         defaultLienTimeoutSlots: null,
  //         paused: null,
  //       })
  //       .accounts({ admin: admin.publicKey, platformConfig })
  //       .signers([admin])
  //       .rpc();

  //     const { pda: jobPda } = await createJob(program, client, LAMPORTS_PER_SOL, MIN_EXPIRY_SLOTS + 20);
  //     await acceptJob(program, freelancer, jobPda);

  //     await program.methods
  //       .initiateLien()
  //       .accounts({
  //         signer: client.publicKey,
  //         jobAccount: jobPda,
  //         platformConfig,
  //       })
  //       .signers([client])
  //       .rpc();

  //     const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);

  //     await expectIxError(
  //       program.methods
  //         .resolveLien({ freelancerShareBps: 10001 })
  //         .accounts({
  //           jobAccount: jobPda,
  //           arbiter: arbiter.publicKey,
  //           clientWallet: client.publicKey,
  //           freelancerWallet: freelancer.publicKey,
  //           providerAccount: providerPda,
  //           treasury: treasury.publicKey,
  //         })
  //         .signers([arbiter])
  //         .rpc(),
  //       "InvalidShareBps",
  //     );
  //   });

  //   it("blocks zero stake amount", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const staker = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);
  //     const [stakePda] = getStakePDA(program.programId, staker.publicKey, freelancer.publicKey);

  //     await expectIxError(
  //       program.methods
  //         .stakeOnProvider(new anchor.BN(0))
  //         .accounts({
  //           staker: staker.publicKey,
  //           providerAccount: providerPda,
  //           stakingAccount: stakePda,
  //           systemProgram: SystemProgram.programId,
  //         })
  //         .signers([staker])
  //         .rpc(),
  //       "InvalidAmount",
  //     );
  //   });

  //   it("blocks setting treasury to default pubkey", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);

  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);

  //     await expectIxError(
  //       program.methods
  //         .updatePlatformConfig({
  //           feeBps: null,
  //           treasury: anchor.web3.PublicKey.default,
  //           addArbiter: null,
  //           removeArbiter: null,
  //           defaultLienTimeoutSlots: null,
  //           paused: null,
  //         })
  //         .accounts({ admin: admin.publicKey, platformConfig })
  //         .signers([admin])
  //         .rpc(),
  //       "InvalidTreasury",
  //     );
  //   });

  //   it("blocks removing non-existent arbiter", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const nonExistentArbiter = Keypair.generate();

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);

  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);

  //     await expectIxError(
  //       program.methods
  //         .updatePlatformConfig({
  //           feeBps: null,
  //           treasury: null,
  //           addArbiter: null,
  //           removeArbiter: nonExistentArbiter.publicKey,
  //           defaultLienTimeoutSlots: null,
  //           paused: null,
  //         })
  //         .accounts({ admin: admin.publicKey, platformConfig })
  //         .signers([admin])
  //         .rpc(),
  //       "ArbiterNotFound",
  //     );
  //   });
  // });

  // // ============================================================
  // // ADVERSARIAL TESTS - State Transitions
  // // ============================================================

  // describe("Adversarial: State Transitions", () => {
  //   it("blocks completing an open (not active) job", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     const { pda: jobPda } = await createJob(program, client, LAMPORTS_PER_SOL, MIN_EXPIRY_SLOTS + 20);

  //     const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);

  //     await expectIxError(
  //       program.methods
  //         .completeJob()
  //         .accounts({
  //           jobAccount: jobPda,
  //           client: client.publicKey,
  //           freelancerWallet: freelancer.publicKey,
  //           providerAccount: providerPda,
  //           treasury: treasury.publicKey,
  //         })
  //         .signers([client])
  //         .rpc(),
  //       "InvalidJobStatus",
  //     );
  //   });

  //   it("blocks accepting an already active job", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const freelancer1 = await createAndFundWallet(provider, 10);
  //     const freelancer2 = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer1);
  //     await registerProvider(program, freelancer2);

  //     const { pda: jobPda } = await createJob(program, client, LAMPORTS_PER_SOL, MIN_EXPIRY_SLOTS + 20);
  //     await acceptJob(program, freelancer1, jobPda);

  //     await expectIxError(acceptJob(program, freelancer2, jobPda), "InvalidJobStatus");
  //   });

  //   it("blocks initiating lien on non-active job", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const arbiter = await createAndFundWallet(provider, 5);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);

  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  //     await program.methods
  //       .updatePlatformConfig({
  //         feeBps: null,
  //         treasury: null,
  //         addArbiter: arbiter.publicKey,
  //         removeArbiter: null,
  //         defaultLienTimeoutSlots: null,
  //         paused: null,
  //       })
  //       .accounts({ admin: admin.publicKey, platformConfig })
  //       .signers([admin])
  //       .rpc();

  //     const { pda: jobPda } = await createJob(program, client, LAMPORTS_PER_SOL, MIN_EXPIRY_SLOTS + 20);

  //     await expectIxError(
  //       program.methods
  //         .initiateLien()
  //         .accounts({
  //           signer: client.publicKey,
  //           jobAccount: jobPda,
  //           platformConfig,
  //         })
  //         .signers([client])
  //         .rpc(),
  //       "InvalidJobStatus",
  //     );
  //   });

  //   it("blocks initiating lien when no arbiters configured", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);

  //     const { pda: jobPda } = await createJob(program, client, LAMPORTS_PER_SOL, MIN_EXPIRY_SLOTS + 20);
  //     await acceptJob(program, freelancer, jobPda);

  //     await expectIxError(
  //       program.methods
  //         .initiateLien()
  //         .accounts({
  //           signer: client.publicKey,
  //           jobAccount: jobPda,
  //           platformConfig,
  //         })
  //         .signers([client])
  //         .rpc(),
  //       "NoArbitersAvailable",
  //     );
  //   });

  //   it("blocks cancelling active job before expiry", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     const { pda: jobPda } = await createJob(program, client, LAMPORTS_PER_SOL, MIN_EXPIRY_SLOTS + 20);
  //     await acceptJob(program, freelancer, jobPda);

  //     await expectIxError(
  //       program.methods
  //         .cancelJob()
  //         .accounts({ jobAccount: jobPda, client: client.publicKey })
  //         .signers([client])
  //         .rpc(),
  //       "JobNotExpired",
  //     );
  //   });

  //   it("blocks double lien initiation", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);
  //     const arbiter = await createAndFundWallet(provider, 5);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  //     await program.methods
  //       .updatePlatformConfig({
  //         feeBps: null,
  //         treasury: null,
  //         addArbiter: arbiter.publicKey,
  //         removeArbiter: null,
  //         defaultLienTimeoutSlots: null,
  //         paused: null,
  //       })
  //       .accounts({ admin: admin.publicKey, platformConfig })
  //       .signers([admin])
  //       .rpc();

  //     const { pda: jobPda } = await createJob(program, client, LAMPORTS_PER_SOL, MIN_EXPIRY_SLOTS + 20);
  //     await acceptJob(program, freelancer, jobPda);

  //     await program.methods
  //       .initiateLien()
  //       .accounts({
  //         signer: client.publicKey,
  //         jobAccount: jobPda,
  //         platformConfig,
  //       })
  //       .signers([client])
  //       .rpc();

  //     // Second lien initiation should fail
  //     await expectIxError(
  //       program.methods
  //         .initiateLien()
  //         .accounts({
  //           signer: freelancer.publicKey,
  //           jobAccount: jobPda,
  //           platformConfig,
  //         })
  //         .signers([freelancer])
  //         .rpc(),
  //       "InvalidJobStatus",
  //     );
  //   });
  // });

  // // ============================================================
  // // ADVERSARIAL TESTS - Edge Cases & Boundaries
  // // ============================================================

  // describe("Edge Cases & Boundaries", () => {
  //   it("handles lien resolution with 0% to freelancer (full refund to client)", async () => {
  //     const feeBps = 250;
  //     const amount = 2 * LAMPORTS_PER_SOL;

  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);
  //     const arbiter = await createAndFundWallet(provider, 5);

  //     await initializePlatform(program, admin, feeBps, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  //     await program.methods
  //       .updatePlatformConfig({
  //         feeBps: null,
  //         treasury: null,
  //         addArbiter: arbiter.publicKey,
  //         removeArbiter: null,
  //         defaultLienTimeoutSlots: null,
  //         paused: null,
  //       })
  //       .accounts({ admin: admin.publicKey, platformConfig })
  //       .signers([admin])
  //       .rpc();

  //     const { pda: jobPda } = await createJob(program, client, amount, MIN_EXPIRY_SLOTS + 20);
  //     await acceptJob(program, freelancer, jobPda);

  //     await program.methods
  //       .initiateLien()
  //       .accounts({
  //         signer: client.publicKey,
  //         jobAccount: jobPda,
  //         platformConfig,
  //       })
  //       .signers([client])
  //       .rpc();

  //     const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);
  //     const clientBefore = await provider.connection.getBalance(client.publicKey);
  //     const freelancerBefore = await provider.connection.getBalance(freelancer.publicKey);
  //     const treasuryBefore = await provider.connection.getBalance(treasury.publicKey);

  //     await program.methods
  //       .resolveLien({ freelancerShareBps: 0 })
  //       .accounts({
  //         jobAccount: jobPda,
  //         arbiter: arbiter.publicKey,
  //         clientWallet: client.publicKey,
  //         freelancerWallet: freelancer.publicKey,
  //         providerAccount: providerPda,
  //         treasury: treasury.publicKey,
  //       })
  //       .signers([arbiter])
  //       .rpc();

  //     const clientAfter = await provider.connection.getBalance(client.publicKey);
  //     const freelancerAfter = await provider.connection.getBalance(freelancer.publicKey);
  //     const treasuryAfter = await provider.connection.getBalance(treasury.publicKey);

  //     // Client gets full refund (plus rent from closed account)
  //     expect(clientAfter - clientBefore).to.be.greaterThan(amount - 10_000);
  //     // Freelancer gets nothing
  //     expect(freelancerAfter - freelancerBefore).to.equal(0);
  //     // No fee since 0 payout
  //     expect(treasuryAfter - treasuryBefore).to.equal(0);

  //     // Provider should have lost the dispute
  //     const providerAfter = await program.account.providerAccount.fetch(providerPda);
  //     expectBnEq(providerAfter.totalJobsDisputedLost, 1);
  //   });

  //   it("handles lien resolution with 100% to freelancer", async () => {
  //     const feeBps = 250;
  //     const amount = 2 * LAMPORTS_PER_SOL;

  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);
  //     const arbiter = await createAndFundWallet(provider, 5);

  //     await initializePlatform(program, admin, feeBps, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  //     await program.methods
  //       .updatePlatformConfig({
  //         feeBps: null,
  //         treasury: null,
  //         addArbiter: arbiter.publicKey,
  //         removeArbiter: null,
  //         defaultLienTimeoutSlots: null,
  //         paused: null,
  //       })
  //       .accounts({ admin: admin.publicKey, platformConfig })
  //       .signers([admin])
  //       .rpc();

  //     const { pda: jobPda } = await createJob(program, client, amount, MIN_EXPIRY_SLOTS + 20);
  //     await acceptJob(program, freelancer, jobPda);

  //     await program.methods
  //       .initiateLien()
  //       .accounts({
  //         signer: client.publicKey,
  //         jobAccount: jobPda,
  //         platformConfig,
  //       })
  //       .signers([client])
  //       .rpc();

  //     const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);
  //     const freelancerBefore = await provider.connection.getBalance(freelancer.publicKey);
  //     const treasuryBefore = await provider.connection.getBalance(treasury.publicKey);

  //     await program.methods
  //       .resolveLien({ freelancerShareBps: 10000 })
  //       .accounts({
  //         jobAccount: jobPda,
  //         arbiter: arbiter.publicKey,
  //         clientWallet: client.publicKey,
  //         freelancerWallet: freelancer.publicKey,
  //         providerAccount: providerPda,
  //         treasury: treasury.publicKey,
  //       })
  //       .signers([arbiter])
  //       .rpc();

  //     const fee = Math.floor((amount * feeBps) / 10_000);
  //     const expectedPayout = amount - fee;

  //     const freelancerAfter = await provider.connection.getBalance(freelancer.publicKey);
  //     const treasuryAfter = await provider.connection.getBalance(treasury.publicKey);

  //     expect(freelancerAfter - freelancerBefore).to.equal(expectedPayout);
  //     expect(treasuryAfter - treasuryBefore).to.equal(fee);

  //     // Provider should NOT have lost the dispute (share >= 50%)
  //     const providerAfter = await program.account.providerAccount.fetch(providerPda);
  //     expectBnEq(providerAfter.totalJobsDisputedLost, 0);
  //   });

  //   it("dispute boundary: 49.99% marks as lost, 50% does not", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);
  //     const arbiter = await createAndFundWallet(provider, 5);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  //     await program.methods
  //       .updatePlatformConfig({
  //         feeBps: null,
  //         treasury: null,
  //         addArbiter: arbiter.publicKey,
  //         removeArbiter: null,
  //         defaultLienTimeoutSlots: null,
  //         paused: null,
  //       })
  //       .accounts({ admin: admin.publicKey, platformConfig })
  //       .signers([admin])
  //       .rpc();

  //     // Test 4999 bps (49.99%) - should count as loss
  //     const { pda: jobPda1 } = await createJob(program, client, LAMPORTS_PER_SOL, MIN_EXPIRY_SLOTS + 20);
  //     await acceptJob(program, freelancer, jobPda1);

  //     await program.methods
  //       .initiateLien()
  //       .accounts({ signer: client.publicKey, jobAccount: jobPda1, platformConfig })
  //       .signers([client])
  //       .rpc();

  //     const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);

  //     await program.methods
  //       .resolveLien({ freelancerShareBps: 4999 })
  //       .accounts({
  //         jobAccount: jobPda1,
  //         arbiter: arbiter.publicKey,
  //         clientWallet: client.publicKey,
  //         freelancerWallet: freelancer.publicKey,
  //         providerAccount: providerPda,
  //         treasury: treasury.publicKey,
  //       })
  //       .signers([arbiter])
  //       .rpc();

  //     let providerAfter = await program.account.providerAccount.fetch(providerPda);
  //     expectBnEq(providerAfter.totalJobsDisputedLost, 1);

  //     // Test 5000 bps (50%) - should NOT count as loss
  //     const { pda: jobPda2 } = await createJob(program, client, LAMPORTS_PER_SOL, MIN_EXPIRY_SLOTS + 20);
  //     await acceptJob(program, freelancer, jobPda2);

  //     await program.methods
  //       .initiateLien()
  //       .accounts({ signer: client.publicKey, jobAccount: jobPda2, platformConfig })
  //       .signers([client])
  //       .rpc();

  //     await program.methods
  //       .resolveLien({ freelancerShareBps: 5000 })
  //       .accounts({
  //         jobAccount: jobPda2,
  //         arbiter: arbiter.publicKey,
  //         clientWallet: client.publicKey,
  //         freelancerWallet: freelancer.publicKey,
  //         providerAccount: providerPda,
  //         treasury: treasury.publicKey,
  //       })
  //       .signers([arbiter])
  //       .rpc();

  //     providerAfter = await program.account.providerAccount.fetch(providerPda);
  //     // Should still be 1, not 2
  //     expectBnEq(providerAfter.totalJobsDisputedLost, 1);
  //   });

  //   it("handles maximum arbiters (10)", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);

  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);

  //     // Add 10 arbiters
  //     for (let i = 0; i < 10; i++) {
  //       const arbiter = Keypair.generate();
  //       await program.methods
  //         .updatePlatformConfig({
  //           feeBps: null,
  //           treasury: null,
  //           addArbiter: arbiter.publicKey,
  //           removeArbiter: null,
  //           defaultLienTimeoutSlots: null,
  //           paused: null,
  //         })
  //         .accounts({ admin: admin.publicKey, platformConfig })
  //         .signers([admin])
  //         .rpc();
  //     }

  //     // 11th arbiter should fail
  //     const extraArbiter = Keypair.generate();
  //     await expectIxError(
  //       program.methods
  //         .updatePlatformConfig({
  //           feeBps: null,
  //           treasury: null,
  //           addArbiter: extraArbiter.publicKey,
  //           removeArbiter: null,
  //           defaultLienTimeoutSlots: null,
  //           paused: null,
  //         })
  //         .accounts({ admin: admin.publicKey, platformConfig })
  //         .signers([admin])
  //         .rpc(),
  //       "ArbiterListFull",
  //     );
  //   });

  //   it("handles unstake amount greater than staked balance", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const staker = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 1);
  //     await registerProvider(program, freelancer);

  //     const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);
  //     const [stakePda] = getStakePDA(program.programId, staker.publicKey, freelancer.publicKey);

  //     const stakeAmount = LAMPORTS_PER_SOL;
  //     await program.methods
  //       .stakeOnProvider(new anchor.BN(stakeAmount))
  //       .accounts({
  //         staker: staker.publicKey,
  //         providerAccount: providerPda,
  //         stakingAccount: stakePda,
  //         systemProgram: SystemProgram.programId,
  //       })
  //       .signers([staker])
  //       .rpc();

  //     // Warp past cooldown
  //     await tickSlots(3);

  //     // Try to unstake more than staked
  //     await expectIxError(
  //       program.methods
  //         .unstakeFromProvider(new anchor.BN(stakeAmount * 2))
  //         .accounts({
  //           staker: staker.publicKey,
  //           stakingAccount: stakePda,
  //           providerAccount: providerPda,
  //         })
  //         .signers([staker])
  //         .rpc(),
  //       "InsufficientStake",
  //     );
  //   });

  //   it("verifies fee snapshot is used, not current fee", async () => {
  //     const initialFeeBps = 250;
  //     const newFeeBps = 500;
  //     const amount = 2 * LAMPORTS_PER_SOL;

  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, initialFeeBps, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     // Create job with initial fee
  //     const { pda: jobPda } = await createJob(program, client, amount, MIN_EXPIRY_SLOTS + 20);
  //     await acceptJob(program, freelancer, jobPda);

  //     // Update fee after job created
  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  //     await program.methods
  //       .updatePlatformConfig({
  //         feeBps: newFeeBps,
  //         treasury: null,
  //         addArbiter: null,
  //         removeArbiter: null,
  //         defaultLienTimeoutSlots: null,
  //         paused: null,
  //       })
  //       .accounts({ admin: admin.publicKey, platformConfig })
  //       .signers([admin])
  //       .rpc();

  //     const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);
  //     const treasuryBefore = await provider.connection.getBalance(treasury.publicKey);

  //     await program.methods
  //       .completeJob()
  //       .accounts({
  //         jobAccount: jobPda,
  //         client: client.publicKey,
  //         freelancerWallet: freelancer.publicKey,
  //         providerAccount: providerPda,
  //         treasury: treasury.publicKey,
  //       })
  //       .signers([client])
  //       .rpc();

  //     const treasuryAfter = await provider.connection.getBalance(treasury.publicKey);
  //     const actualFee = treasuryAfter - treasuryBefore;

  //     // Fee should be based on snapshot (250 bps), not new fee (500 bps)
  //     const expectedFee = Math.floor((amount * initialFeeBps) / 10_000);
  //     const wrongFee = Math.floor((amount * newFeeBps) / 10_000);

  //     expect(actualFee).to.equal(expectedFee);
  //     expect(actualFee).to.not.equal(wrongFee);
  //   });

  //   it("freelancer can initiate lien", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const client = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);
  //     const arbiter = await createAndFundWallet(provider, 5);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     const [platformConfig] = getPlatformConfigPDA(program.programId, admin.publicKey);
  //     await program.methods
  //       .updatePlatformConfig({
  //         feeBps: null,
  //         treasury: null,
  //         addArbiter: arbiter.publicKey,
  //         removeArbiter: null,
  //         defaultLienTimeoutSlots: null,
  //         paused: null,
  //       })
  //       .accounts({ admin: admin.publicKey, platformConfig })
  //       .signers([admin])
  //       .rpc();

  //     const { pda: jobPda } = await createJob(program, client, LAMPORTS_PER_SOL, MIN_EXPIRY_SLOTS + 20);
  //     await acceptJob(program, freelancer, jobPda);

  //     // Freelancer initiates lien (not client)
  //     await program.methods
  //       .initiateLien()
  //       .accounts({
  //         signer: freelancer.publicKey,
  //         jobAccount: jobPda,
  //         platformConfig,
  //       })
  //       .signers([freelancer])
  //       .rpc();

  //     const jobAccount = await program.account.jobAccount.fetch(jobPda);
  //     expectJobStatus(jobAccount, "lienActive");
  //     expect(jobAccount.lienInitiator.toBase58()).to.equal(freelancer.publicKey.toBase58());
  //   });

  //   it("multiple stakers can stake on same provider", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const staker1 = await createAndFundWallet(provider, 10);
  //     const staker2 = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);
  //     const [stakePda1] = getStakePDA(program.programId, staker1.publicKey, freelancer.publicKey);
  //     const [stakePda2] = getStakePDA(program.programId, staker2.publicKey, freelancer.publicKey);

  //     await program.methods
  //       .stakeOnProvider(new anchor.BN(LAMPORTS_PER_SOL))
  //       .accounts({
  //         staker: staker1.publicKey,
  //         providerAccount: providerPda,
  //         stakingAccount: stakePda1,
  //         systemProgram: SystemProgram.programId,
  //       })
  //       .signers([staker1])
  //       .rpc();

  //     await program.methods
  //       .stakeOnProvider(new anchor.BN(LAMPORTS_PER_SOL * 2))
  //       .accounts({
  //         staker: staker2.publicKey,
  //         providerAccount: providerPda,
  //         stakingAccount: stakePda2,
  //         systemProgram: SystemProgram.programId,
  //       })
  //       .signers([staker2])
  //       .rpc();

  //     const providerAfter = await program.account.providerAccount.fetch(providerPda);
  //     expectBnEq(providerAfter.totalStaked, LAMPORTS_PER_SOL * 3);
  //     expect(providerAfter.stakerCount).to.equal(2);
  //   });

  //   it("same staker can add to existing stake", async () => {
  //     const admin = await createAndFundWallet(provider, 10);
  //     const treasury = await createAndFundWallet(provider, 2);
  //     const staker = await createAndFundWallet(provider, 10);
  //     const freelancer = await createAndFundWallet(provider, 10);

  //     await initializePlatform(program, admin, 250, treasury.publicKey, 20);
  //     await registerProvider(program, freelancer);

  //     const [providerPda] = getProviderPDA(program.programId, freelancer.publicKey);
  //     const [stakePda] = getStakePDA(program.programId, staker.publicKey, freelancer.publicKey);

  //     // First stake
  //     await program.methods
  //       .stakeOnProvider(new anchor.BN(LAMPORTS_PER_SOL))
  //       .accounts({
  //         staker: staker.publicKey,
  //         providerAccount: providerPda,
  //         stakingAccount: stakePda,
  //         systemProgram: SystemProgram.programId,
  //       })
  //       .signers([staker])
  //       .rpc();

  //     let stakeAccount = await program.account.stakingAccount.fetch(stakePda);
  //     expectBnEq(stakeAccount.amount, LAMPORTS_PER_SOL);

  //     // Second stake (adds to existing)
  //     await program.methods
  //       .stakeOnProvider(new anchor.BN(LAMPORTS_PER_SOL))
  //       .accounts({
  //         staker: staker.publicKey,
  //         providerAccount: providerPda,
  //         stakingAccount: stakePda,
  //         systemProgram: SystemProgram.programId,
  //       })
  //       .signers([staker])
  //       .rpc();

  //     stakeAccount = await program.account.stakingAccount.fetch(stakePda);
  //     expectBnEq(stakeAccount.amount, LAMPORTS_PER_SOL * 2);

  //     // Staker count should still be 1
  //     const providerAfter = await program.account.providerAccount.fetch(providerPda);
  //     expect(providerAfter.stakerCount).to.equal(1);
  //   });
  // });
});
