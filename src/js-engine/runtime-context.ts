import type { TaskScheduling } from '../infra/scheduling';
import type { RuntimeBuffers } from './buffers';
import type { Promises } from './promises';
import type { GlobalObject } from './realm';

/** Implementation facilities composed for one owning realm/global. */
export type RuntimeContext = {
  /** The owning global object, including when selected as an HTML task destination. */
  global: GlobalObject;
  nativeLineEnding: '\n' | '\r\n';
  promises: Promises;
  buffers: RuntimeBuffers;
  fileReading: TaskScheduling;
  networking: NetworkingTasks;
  timing: {
    coarsenTime(timestamp: number, crossOriginIsolatedCapability: boolean): number;
  };

  queueMicrotask(steps: () => void): void;
  createAbortController(): AbortControllerCapability;
  /** Parse JSON in the owner's realm without calling an author-replaced JSON.parse. */
  parseJSON(text: string): unknown;
  /** HTML structured cloning into the owner's realm. */
  clone(value: unknown): unknown;
  /** HTML structured serialization; the provider owns the opaque record. */
  serialize(value: unknown): object;
  /** Reconstruct a serialized record in the owner's realm. */
  deserialize(record: object): unknown;
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
