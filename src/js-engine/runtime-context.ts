import type { TaskScheduling } from '../infra/scheduling';
import type { RuntimeBuffers } from './buffers';
import type { Promises } from './promises';
import type { GlobalObject } from './realm';

/** Implementation facilities composed for one owning realm/global. */
export type RuntimeContext = {
  readonly nativeLineEnding: '\n' | '\r\n';
  readonly promises: Promises;
  readonly buffers: RuntimeBuffers;
  readonly fileReading: TaskScheduling;
  readonly networking: NetworkingTasks;

  queueMicrotask(steps: () => void): void;
  createAbortController(): AbortControllerCapability;
  /** HTML structured cloning into the owner's realm. */
  clone(value: unknown): unknown;
};

export type NetworkingTasks = {
  queueGlobalTask: (global: GlobalObject, steps: () => void) => void;
  runInParallel: (steps: () => void) => void;
};

export type AbortControllerCapability = {
  readonly signal: AbortSignalCapability;
  abort(reason?: unknown): void;
};

export type AbortSignalCapability = {
  readonly aborted: boolean;
  readonly reason: unknown;
  addAlgorithm(steps: () => void): AbortAlgorithmHandle | null;
};

export type AbortAlgorithmHandle = {
  remove(): void;
};
