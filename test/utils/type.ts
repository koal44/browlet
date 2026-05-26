export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function assertNever(x: never): never {
  throw new Error(`Unexpected key: ${String(x)}`);
}

export type Permutations<T, K = T> =
  [T] extends [never] ? [] :
  T extends K ? [T, ...Permutations<Exclude<K, T>>] : never;
