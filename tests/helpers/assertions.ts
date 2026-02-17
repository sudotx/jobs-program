import { expect } from "chai";

export function enumKey(value: Record<string, unknown>): string {
  return Object.keys(value)[0];
}

export function expectJobStatus(job: { status: Record<string, unknown> }, expected: string): void {
  expect(enumKey(job.status)).to.equal(expected);
}

export function expectBnEq(value: { toNumber: () => number }, expected: number): void {
  expect(value.toNumber()).to.equal(expected);
}
