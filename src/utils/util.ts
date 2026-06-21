export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${String(value)}`);
}

export function clamp(n: number, min: number, max: number): number {
  if (min > max) throw new RangeError('min must be ≤ max');
  return Math.min(Math.max(n, min), max);
}

export function requireDefined<T>(
  value: T | null | undefined,
  message: string | ((v?: T | null) => string) = 'Value is required and cannot be null or undefined',
): T {
  if (value !== null && value !== undefined) {
    return value;
  }

  throw new Error(typeof message === 'function' ? message(value) : message);
}
