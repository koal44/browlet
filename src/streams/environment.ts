import type { AbortController, AbortSignal } from '../infra/abort';
import type { JSEnvironment } from '../js-engine/index';

/** The owning environment's DOM abort and HTML structured-data operations used by Streams. */
export interface StreamsEnvironment extends JSEnvironment {
  /** Create a controller and its signal in the owner's realm. */
  createAbortController(): AbortController;
  /** Create a signal that follows the supplied signals in the owner's realm. */
  createDependentAbortSignal(signals: AbortSignal[]): AbortSignal;
  /** Clone into the owner's realm, optionally transferring objects. */
  clone(value: unknown, transferList?: object[]): unknown;
  /** Serialize a value; the provider owns the opaque record. */
  serialize(value: unknown): object;
  /** Reconstruct a record from the same provider in the owner's realm. */
  deserialize(record: object): unknown;
}
