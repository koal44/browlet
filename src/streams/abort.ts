export type StreamAbortController = {
  abort(reason?: unknown): void;
  readonly signal: StreamAbortSignal;
};

export type StreamAbortAlgorithmHandle = {
  remove(): void;
};

export type StreamAbortSignal = {
  readonly aborted: boolean;
  readonly reason: unknown;
  addAlgorithm(
    algorithm: () => void,
  ): StreamAbortAlgorithmHandle | null;
};
