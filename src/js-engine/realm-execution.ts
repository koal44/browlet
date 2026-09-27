import type { TaskScheduling } from '../infra/scheduling';
import type { RuntimeBuffers } from './buffers';
import type { InternalPromise } from '../infra/promises';
import type { GlobalObject } from './realm';

/** Persistent execution and allocation facilities for one owning realm/global. */
export type RealmExecution = {
  /** The owning global object, including when selected as an HTML task destination. */
  global: GlobalObject;
  nativeLineEnding: '\n' | '\r\n';
  /** Internal Promise constructor for this execution owner. */
  Promise: typeof InternalPromise;
  /** Captured JavaScript constructor for native Promise resolution. */
  NativePromise: PromiseConstructor;
  buffers: RuntimeBuffers;
  fileReading: TaskScheduling;
  networking: NetworkingTasks;

  queueMicrotask(steps: () => void): void;
  /** Schedule background steps without invoking them inline or entering an owner task. */
  runInParallel: (steps: () => void) => void;
  createAbortController(): AbortControllerCapability;
  /** Create a DOM dependent signal in the owner's realm. */
  createDependentAbortSignal(signals: AbortSignalCapability[]): AbortSignalCapability;
  /** Parse JSON in the owner's realm without calling an author-replaced JSON.parse. */
  parseJSON(text: string): unknown;
  /** Serialize using the owner's captured JSON intrinsic. */
  stringifyJSON(value: unknown): string | undefined;
  /** HTML structured cloning into the owner's realm, optionally transferring objects. */
  clone(value: unknown, transferList?: object[]): unknown;
  /** HTML structured serialization; the provider owns the opaque record. */
  serialize(value: unknown): object;
  /** Reconstruct a serialized record in the owner's realm. */
  deserialize(record: object): unknown;
};

export type NetworkingTasks = {
  queueGlobalTask: (global: GlobalObject, steps: () => void) => void;
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
