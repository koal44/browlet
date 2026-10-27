/** Implementation-side controller that owns its signal's cancellation. */
export type AbortController = {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
};

/** Implementation-side abort state and algorithm registration, independent of platform event listeners. */
export type AbortSignal = {
  readonly aborted: boolean;
  readonly reason: unknown;
  addAlgorithm(steps: () => void): AbortAlgorithmHandle | null;
};

/** Remove an abort algorithm before its signal is aborted. */
export type AbortAlgorithmHandle = {
  remove(): void;
};
