import { expect } from "chai";

export function enumKey(value: Record<string, unknown>): string {
  return Object.keys(value)[0];
}

export function expectJobStatus(job: { status: Record<string, unknown> }, expected: string): void {
  expect(enumKey(job.status)).to.equal(expected);
}

export function expectBnEq(value: { toString: () => string }, expected: number | bigint): void {
  expect(value.toString()).to.equal(BigInt(expected).toString());
}

export async function expectIxError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
  } catch (err: any) {
    const raw = [err?.message, JSON.stringify(err), JSON.stringify(err?.error)].join(" ");
    expect(raw).to.contain(code);
    return;
  }
  throw new Error(`Expected instruction to fail with ${code}`);
}
