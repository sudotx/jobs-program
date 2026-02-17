import { PublicKey } from "@solana/web3.js";

export function getJobPDA(
  programId: PublicKey,
  client: PublicKey,
  nonce: number,
): [PublicKey, number] {
  const nonceLe = Buffer.alloc(8);
  nonceLe.writeBigUInt64LE(BigInt(nonce));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("job"), client.toBuffer(), nonceLe],
    programId,
  );
}

export function getProviderPDA(
  programId: PublicKey,
  freelancer: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("provider"), freelancer.toBuffer()],
    programId,
  );
}

export function getStakePDA(
  programId: PublicKey,
  staker: PublicKey,
  freelancer: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), staker.toBuffer(), freelancer.toBuffer()],
    programId,
  );
}

export function getPlatformConfigPDA(
  programId: PublicKey,
  admin: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("platform"), admin.toBuffer()],
    programId,
  );
}

export function getClientAccountPDA(
  programId: PublicKey,
  client: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("client"), client.toBuffer()],
    programId,
  );
}
