import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { FreelanceEscrow } from "../target/types/freelance_escrow";

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);

  const program = anchor.workspace
    .FreelanceEscrow as Program<FreelanceEscrow>;
  const admin = provider.wallet.publicKey;

  // Platform parameters
  const feeBps = 500; // 5% platform fee
  const treasury = admin; // Use admin as treasury (update for production)
  const defaultLienTimeoutSlots = new anchor.BN(648_000); // ~3 days

  // Derive the platform config PDA
  const [platformConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("platform"), admin.toBuffer()],
    program.programId
  );

  // Check if platform is already initialized
  try {
    const existing = await program.account.platformConfig.fetch(
      platformConfigPda
    );
    console.log("Platform already initialized:");
    console.log("  Admin:", existing.admin.toBase58());
    console.log("  Fee BPS:", existing.feeBps);
    console.log("  Treasury:", existing.treasury.toBase58());
    console.log("  Paused:", existing.paused);
    return;
  } catch {
    // Account doesn't exist yet — proceed with initialization
  }

  console.log("Initializing platform...");
  console.log("  Admin:", admin.toBase58());
  console.log("  Fee BPS:", feeBps);
  console.log("  Treasury:", treasury.toBase58());
  console.log("  Lien Timeout Slots:", defaultLienTimeoutSlots.toString());

  const tx = await program.methods
    .initializePlatform(feeBps, treasury, defaultLienTimeoutSlots)
    .accounts({
      admin,
    } as any)
    .rpc();

  console.log("Platform initialized! Tx:", tx);

  // Verify
  const config = await program.account.platformConfig.fetch(platformConfigPda);
  console.log("Verification:");
  console.log("  Admin:", config.admin.toBase58());
  console.log("  Fee BPS:", config.feeBps);
  console.log("  Treasury:", config.treasury.toBase58());
  console.log("  Paused:", config.paused);
};
