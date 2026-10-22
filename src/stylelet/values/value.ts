import type { ValueStage } from '../value-processing/index';

/** A CSS value that resolves with the caller's context and serializes its current state. */
export interface Value<Context = unknown> {
  /** Produce the value at the requested stage, retaining identity when nothing changes. */
  resolve(stage: ValueStage, context: Context): Value<Context>;
  /** Describe the current value without advancing its lifecycle or applying context. */
  serialize(): string;
}
