import { InternalError } from '../../infra/internal-error';

import type { ParserInput } from '../syntax/index';
import type { ValueStage, LayoutContext } from '../value-processing/index';
import type {
  WholeValue, ColorContext, GradientContext, MathContext, PositionContext, UrlContext,
  SupportsContext, SubstitutionContext, PercentageReferenceValue,
} from '../values/index';
import type { RegistryContext } from './registry';

// Type parameters: W = whole property value, N = property name.

/** Shared metadata and value operations for a named built-in or custom property. */
export abstract class BaseProperty<W extends WholeValue = WholeValue, N extends string = string> {
  name: N;
  abstract custom: boolean;
  /** Whether defaulting inherits the parent's computed value. */
  abstract inherits: boolean;
  /** Shared Declared representation; resolution must leave this value unchanged. */
  abstract initialValue: W;
  /** Animation category or property-specific operations on whole property values. */
  abstract animationType: AnimationType<W>;
  /** Property-level percentage interpretation and any contextual reference it requires. */
  abstract percentages: PropertyPercentages;
  /** Lifecycle stage exposed by CSSOM's getComputedStyle(). */
  abstract resolvedValueStage: ResolvedValueStage;
  /** Group and mapping used to preserve order between physical and logical properties. */
  logicalGroup?: LogicalPropertyGroup;

  constructor(name: N) {
    this.name = name;
  }

  /** Test applicability; unavailable target facts must throw rather than imply false. */
  // https://drafts.csswg.org/css-cascade-5/#applies-to
  abstract appliesTo(context: PropertyContext): boolean;

  abstract parse(input: ParserInput, context: PropertyContext): W | null;
  abstract resolve(propValue: W, stage: ValueStage, context: PropertyContext): W;

  /** Describe the retained value without advancing its lifecycle. */
  serialize(propValue: W): string {
    return propValue.serialize();
  }

  /** Interpolate computed values, allowing extrapolation; null excludes the property from animation. */
  abstract interpolate(from: W, to: W, progress: number, context: PropertyContext): WholeValue | null;
  /** Add an effect to its underlying value; leave final range checking to resolution. */
  abstract add(underlying: W, effect: W, context: PropertyContext): WholeValue | null;
  /** Accumulate an effect without clamping intermediate results. */
  abstract accumulate(underlying: W, effect: W, context: PropertyContext): WholeValue | null;

  /** Exclude non-animatable properties and reject unfinished animation categories. */
  // https://drafts.csswg.org/web-animations-1/#animating-properties
  protected canAnimate(): boolean {
    if (this.animationType === 'repeatable-list') {
      // TODO: Repeat lists to their least common multiple before operating on corresponding items.
      throw new InternalError('Repeatable-list property animation is not implemented');
    }
    return this.animationType !== 'not-animatable';
  }

  protected withPercentageReference(stage: ValueStage, context: PropertyContext): PropertyContext {
    const percentages = this.percentages;
    const percentageReferenceValue =
      percentages === 'not-applicable' || percentages === 'number' || stage < percentages.resolveAt
        ? undefined : percentages.reference(context);
    return percentageReferenceValue === context.percentageReferenceValue ? context : { ...context, percentageReferenceValue };
  }
}

/** A standard animation category or the property's own animation behavior. */
// https://drafts.csswg.org/web-animations-1/#animating-properties
export type AnimationType<W extends WholeValue> =
  | 'not-animatable'
  | 'discrete'
  | 'by-computed-value'
  | 'repeatable-list'
  | PropertyAnimation<W>;

/** Operate on whole property values without mutating them; null requests discrete fallback for this pair. */
// Unfinished behavior must throw, not return null as though it were a specified incompatibility.
// The property applies discrete fallback; the animation caller owns timing and effect composition.
export type PropertyAnimation<W extends WholeValue> = {
  interpolate(from: W, to: W, progress: number, context: PropertyContext): W | null;
  add(underlying: W, effect: W, context: PropertyContext): W | null;
  accumulate(underlying: W, effect: W, context: PropertyContext): W | null;
};

/** N/A does not prohibit percentages inside a nested value grammar such as rgb(). */
export type PropertyPercentages =
  | 'not-applicable'
  /** The value grammar maps 100% to 1 without a contextual reference. */
  | 'number'
  | {
    resolveAt: ValueStage;
    /** Return a canonical reference, or undefined while the required fact is unavailable. */
    reference: (context: PropertyContext) => PercentageReferenceValue | undefined;
  };

/** A fixed CSSOM stage or a rule selecting it from the computed whole value and context. */
// https://drafts.csswg.org/cssom/#resolved-values
export type ResolvedValueStage =
  | ValueStage.Computed
  | ValueStage.Used
  | ((propValue: WholeValue, context: PropertyContext) => ValueStage.Computed | ValueStage.Used);

export type LogicalPropertyGroup = { name: string; mapping: 'physical' | 'logical'; };

export type PropertyContext =
  & MathContext
  & ColorContext
  & GradientContext
  & PositionContext
  & UrlContext
  & SupportsContext
  & SubstitutionContext
  & LayoutContext
  & RegistryContext;
