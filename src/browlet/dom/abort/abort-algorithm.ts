export type AbortAlgorithmHandle = {
  remove(): void;
};

type AbortSignalAlgorithmAccess = {
  add(algorithm: () => void): AbortAlgorithmHandle | null;
  isAborted(): boolean;
};

const abortSignals = new WeakMap<object, AbortSignalAlgorithmAccess>();

export function registerAbortSignal(
  signal: object,
  access: AbortSignalAlgorithmAccess,
): void {
  abortSignals.set(signal, access);
}

export function addAbortAlgorithm(
  signal: object,
  algorithm: () => void,
): AbortAlgorithmHandle | null {
  return requireAbortSignal(signal).add(algorithm);
}

export function isAbortedSignal(signal: object): boolean {
  return requireAbortSignal(signal).isAborted();
}

function requireAbortSignal(signal: object): AbortSignalAlgorithmAccess {
  const access = abortSignals.get(signal);
  if (!access) throw new TypeError('Expected an AbortSignal implementation');
  return access;
}
