import { InternalError } from '../../infra/internal-error';

import {
  withTrivia, createComponentParser,
  type TokenCursor, type ParserInput,
} from '../syntax/index';
import { ValueStage } from '../value-processing/index';
import type { PropertyContext } from '../props/index';

import type { Value } from './value';
import { OptionalDeclarationValue } from './declaration-value';
import { CssWideValue, type CssWideKeyword } from './css-wide';
import { SubstitutionValue } from './substitution-value';
import { FirstValidValue } from './substitution/first-valid';
import { GuaranteedInvalidValue, guaranteedInvalidValue } from './guaranteed-invalid';

// Type parameters: O = ordinary value, V = replacement value, K = animation operation.

/** A property's complete value, including notation deferred until its grammar can be applied. */
export class WholeValue<O extends Value = Value> implements Value {
  /** The parsed value or retained whole-value notation. */
  inner: WholeValueContents<O>;
  /** The original shorthand occurrence, shared by its pending longhands. */
  shorthand?: PendingShorthand<O>;
  /** Position in that shorthand's canonical longhand order; set together with shorthand. */
  shorthandIndex?: number;
  /** The consuming grammar, retained for deferred reparsing without retaining context. */
  #parseValue: (input: ParserInput, context: PropertyContext) => O | null;
  /** Registered declarations defer their ordinary grammar until Computed time. */
  #registered: boolean;

  constructor(
    value: WholeValueContents<O>,
    parseValue: (input: ParserInput, context: PropertyContext) => O | null,
    registered = false,
  ) {
    this.inner = value;
    this.#parseValue = parseValue;
    this.#registered = registered;
  }

  /** Parse a complete declaration; registered ordinary syntax remains deferred. */
  static parse<O extends Value>(
    input: ParserInput,
    context: PropertyContext,
    parseValue: (input: ParserInput, context: PropertyContext) => O | null,
    registered = false,
  ): WholeValue<O> | null {
    const declaration = OptionalDeclarationValue.parse(input, context);
    if (declaration === null) return null;
    const notation = wholeValueNotationParser(declaration.repr, context);
    if (notation === null && !SubstitutionValue.hasValidVarArguments(declaration.repr)) return null;

    const value = notation ?? (SubstitutionValue.containsFunction(declaration.repr)
      ? new SubstitutionValue(declaration)
      : registered ? new RawWholeValue(declaration) : parseValue(declaration.repr, context));

    return value === null ? null : new WholeValue<O>(value, parseValue, registered);
  }

  /** Retain one pending longhand with its original shorthand occurrence and ordinary grammar. */
  static fromShorthand<O extends Value>(
    shorthand: PendingShorthand<O>,
    shorthandIndex: number,
    parseValue: (input: ParserInput, context: PropertyContext) => O | null,
  ): WholeValue<O> {
    const value = new WholeValue<O>(shorthand.value, parseValue);
    value.shorthand = shorthand;
    value.shorthandIndex = shorthandIndex;
    return value;
  }

  /** Whether this whole value currently contains the guaranteed-invalid value. */
  isGuaranteedInvalid(): this is this & { inner: GuaranteedInvalidValue; } {
    return this.inner instanceof GuaranteedInvalidValue;
  }

  /** Check for ordinary contents rather than whole-value notation or the invalid sentinel. */
  isOrdinaryValue(): this is this & { inner: O; } {
    const inner = this.inner;
    return !(inner instanceof RawWholeValue || inner instanceof SubstitutionValue || inner instanceof CssWideValue ||
      inner instanceof FirstValidValue || inner instanceof GuaranteedInvalidValue);
  }

  /** Return the CSS-wide keyword awaiting defaulting, if present. */
  cssWideKeyword(): CssWideKeyword | undefined {
    const value = this.inner;
    return value instanceof CssWideValue ? value.repr : undefined;
  }

  /** Whether this is a longhand awaiting expansion of its original shorthand. */
  isPendingSubstitution(): this is this & { shorthand: PendingShorthand<O>; shorthandIndex: number; } {
    return this.shorthand !== undefined;
  }

  /** Resolve with fresh context, preserving ordinary values or returning their resolver's result. */
  resolve(stage: ValueStage, context: PropertyContext): WholeValue<O | ReturnType<O['resolve']>>;
  resolve(stage: ValueStage, context: PropertyContext): WholeValue {
    if (this.isPendingSubstitution()) {
      if (stage < ValueStage.Computed) return this;
      const expanded = this.expandShorthand(context);
      return expanded === null ? this.withValue(guaranteedInvalidValue) : expanded[this.shorthandIndex]!.resolve(stage, context);
    }
    const value = this.inner;
    if (value instanceof RawWholeValue) {
      if (stage < ValueStage.Computed) return this;
      const declaration = value.repr;
      const parsed = WholeValue.parse(declaration.repr, context, this.#parseValue);
      return parsed === null ? this.withValue(guaranteedInvalidValue) : parsed.resolve(stage, context);
    }
    if (value instanceof FirstValidValue) {
      if (stage < ValueStage.Computed) return this;
      // https://drafts.csswg.org/css-values-5/#first-valid
      // Check support against the consuming grammar, including registered syntax.
      // A supported var() argument can still fail at computed time; do not retry.
      for (const argument of value.repr) {
        const parsed = WholeValue.parse<O>(argument.repr, context, this.#parseValue);
        if (parsed !== null) return parsed.resolve(stage, context);
      }
      return this.withValue(guaranteedInvalidValue);
    }
    if (value instanceof SubstitutionValue) {
      if (stage < ValueStage.Computed) return this;
      const { getCustomProperty } = context;
      if (getCustomProperty === undefined) throw new InternalError('Property substitution requires computed custom properties');
      // https://drafts.csswg.org/css-values-5/#resolve-property
      // Reparse components directly: adjacent number/ident tokens must not become a dimension.
      const substituted = value.substitute(getCustomProperty);
      if (substituted instanceof GuaranteedInvalidValue) return this.withValue(substituted);
      const parsed = WholeValue.parse<O>(substituted, context, this.#parseValue, this.#registered);
      return parsed === null ? this.withValue(guaranteedInvalidValue) : parsed.resolve(stage, context);
    }
    return this.withValue(value.resolve(stage, context));
  }

  /** Serialization delegates to the current representation and never reparses or resolves it. */
  serialize(): string {
    // A pending longhand has no author-observable value before shorthand expansion.
    return this.isPendingSubstitution() ? '' : this.inner.serialize();
  }

  /** Expand after isPendingSubstitution(); the cascade can reuse the result for the same element. */
  // https://drafts.csswg.org/css-values-5/#substitution-in-shorthands
  expandShorthand(context: PropertyContext): WholeValue<O>[] | null {
    const shorthand = this.shorthand!;
    const { getCustomProperty } = context;
    if (getCustomProperty === undefined) throw new InternalError('Shorthand substitution requires computed custom properties');
    const substituted = shorthand.value.substitute(getCustomProperty);
    return substituted instanceof GuaranteedInvalidValue ? null : shorthand.expand(substituted, context);
  }

  /** Interpolate contained values, retaining their complete-value grammar. */
  interpolate(this: WholeValue<O & Interpolation<O>>, other: WholeValue<O>, progress: number, context: PropertyContext): AnimationResult<O, 'interpolate'>;
  interpolate(this: WholeValue<O & Interpolation<O>>, other: WholeValue<O>, progress: number, context: PropertyContext): WholeValue | null {
    const a = this.ordinaryValue();
    const b = other.ordinaryValue();
    if (a.interpolate === undefined) throw new InternalError('Computed value interpolation is not implemented for this value type');
    return this.withValue(a.interpolate(b, progress, context), other);
  }

  /** Add contained values without resolving or reparsing the result. */
  add(this: WholeValue<O & Addition<O>>, other: WholeValue<O>, context: PropertyContext): AnimationResult<O, 'add'>;
  add(this: WholeValue<O & Addition<O>>, other: WholeValue<O>, context: PropertyContext): WholeValue | null {
    const a = this.ordinaryValue();
    const b = other.ordinaryValue();
    if (a.add === undefined) throw new InternalError('Computed value addition is not implemented for this value type');
    return this.withValue(a.add(b, context), other);
  }

  /** Accumulate contained values without resolving or reparsing the result. */
  accumulate(this: WholeValue<O & Accumulation<O>>, other: WholeValue<O>, context: PropertyContext): AnimationResult<O, 'accumulate'>;
  accumulate(this: WholeValue<O & Accumulation<O>>, other: WholeValue<O>, context: PropertyContext): WholeValue | null {
    const a = this.ordinaryValue();
    const b = other.ordinaryValue();
    if (a.accumulate === undefined) throw new InternalError('Computed value accumulation is not implemented for this value type');
    return this.withValue(a.accumulate(b, context), other);
  }

  /** Extract an ordinary value after substitution and defaulting have completed. */
  ordinaryValue(): O {
    if (!this.isOrdinaryValue()) throw new InternalError('Expected an ordinary value after substitution and defaulting');
    return this.inner;
  }

  /** Retain a result with this grammar, reusing either operand when its value is unchanged. */
  withValue<V extends Value>(value: WholeValueContents<V>, other?: WholeValue<V>): WholeValue<O | V>;
  withValue<V extends Value>(value: WholeValueContents<V> | null, other?: WholeValue<V>): WholeValue<O | V> | null;
  withValue<V extends Value>(
    value: WholeValueContents<V> | null, other?: WholeValue<V>,
  ): WholeValue<O | V> | null {
    if (value === null) return null;
    return value === this.inner ? this : value === other?.inner ? other :
      new WholeValue<O | V>(value, this.#parseValue, this.#registered);
  }
}

/** The property's ordinary value or retained whole-value notation. */
export type WholeValueContents<O> =
  | O | RawWholeValue | SubstitutionValue | CssWideValue | FirstValidValue | GuaranteedInvalidValue;

/** Retained shorthand syntax and its grammar, without element-specific computed state. */
export type PendingShorthand<O extends Value> = {
  name: string;
  value: SubstitutionValue;
  expand: (input: ParserInput, context: PropertyContext) => WholeValue<O>[] | null;
};

/** Retain the original grammar and the operation's result; null requests discrete fallback. */
type AnimationResult<O extends Value, K extends 'interpolate' | 'add' | 'accumulate'> =
  WholeValue<O | NonNullable<ReturnType<NonNullable<O[K]>>>> | null;

// Function properties check receiver and operand compatibility without TypeScript's method bivariance.
type Interpolation<O extends Value> = {
  interpolate?: (this: O, other: O, progress: number, context: PropertyContext) => Value | null;
};

type Addition<O extends Value> = {
  add?: (this: O, other: O, context: PropertyContext) => Value | null;
};

type Accumulation<O extends Value> = {
  accumulate?: (this: O, other: O, context: PropertyContext) => Value | null;
};

/** A custom declaration retained until its grammar is applied at Computed time. */
export class RawWholeValue {
  /** The original declaration, including valid empty input and source spans. */
  repr: OptionalDeclarationValue;

  constructor(value: OptionalDeclarationValue) {
    this.repr = value;
  }

  /** Serialize the retained source without applying its ordinary grammar. */
  serialize(): string {
    return this.repr.repr.sourceText();
  }
}

function consumeWholeValueNotation(c: TokenCursor): CssWideValue | FirstValidValue | null {
  return CssWideValue.consume(c) ?? FirstValidValue.consume(c);
}

const wholeValueNotationParser = createComponentParser(withTrivia(consumeWholeValueNotation));
