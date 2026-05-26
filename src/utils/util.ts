export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${String(value)}`);
}

export function clamp(n: number, min: number, max: number): number {
  if (min > max) throw new RangeError('min must be ≤ max');
  return Math.min(Math.max(n, min), max);
}
