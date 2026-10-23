import type { ValueStage } from '../value-processing/index';
import type { PropertyContext } from '../props/index';

// Type parameter: C = context.

/** A CSS value that resolves with the caller's context and serializes its current state. */
export interface Value<C = PropertyContext> {
  /** Produce the value at the requested stage, retaining identity when nothing changes. */
  resolve(stage: ValueStage, context: C): Value<C>;
  /** Describe the current value without advancing its lifecycle or applying context. */
  serialize(): string;
  /** Interpolate compatible representations; null requests discrete fallback for an incompatible pair. */
  // Omitted operations are unfinished integration, not a declaration of discrete behavior.
  // Each operation declares its own receiver and operand requirements; Value alone cannot supply them.
  interpolate?: (this: never, other: never, progress: number, context: C) => Value<C> | null;
  /** Add a value of the same type without clamping the intermediate result. */
  add?: (this: never, other: never, context: C) => Value<C> | null;
  /** Accumulate a value of the same type without clamping the intermediate result. */
  accumulate?: (this: never, other: never, context: C) => Value<C> | null;
}
