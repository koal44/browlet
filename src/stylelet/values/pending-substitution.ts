import { InternalError } from '../../infra/internal-error';

import type { ParserInput } from '../syntax/index';
import { ValueStage } from '../value-processing/index';
import type { PropertyContext } from '../props/index';

import type { Value } from './value';
import { WholeValue } from './whole-value';
import type { SubstitutionValue } from './substitution-value';
import { GuaranteedInvalidValue, guaranteedInvalidValue } from './guaranteed-invalid';

/** One longhand whose value must be selected from a substituted shorthand. */
// https://drafts.csswg.org/css-values-5/#substitution-in-shorthands
export class PendingSubstitutionValue<Ordinary extends Value<Context>, Context extends PropertyContext = PropertyContext> extends WholeValue<Ordinary, Context> {
  /** The original shorthand occurrence, shared by all of its longhands. */
  shorthand: PendingShorthand<Ordinary, Context>;
  /** Position of this longhand in the shorthand's expansion. */
  index: number;

  constructor(
    shorthand: PendingShorthand<Ordinary, Context>,
    index: number,
    parseValue: (input: ParserInput, context: Context) => Ordinary | null,
  ) {
    super(shorthand.value, parseValue);
    this.shorthand = shorthand;
    this.index = index;
  }

  /** Substitute and parse the original shorthand before selecting this longhand. */
  override resolve(
    stage: ValueStage,
    context: Context,
  ): WholeValue<Ordinary | ReturnType<Ordinary['resolve']>, Context> {
    if (stage < ValueStage.Computed) return this;
    const expanded = this.expand(context);
    return expanded === null
      ? this.withValue<Ordinary>(guaranteedInvalidValue)
      : expanded[this.index]!.resolve(stage, context);
  }

  /** Expand all longhands together; the cascade can reuse this result for the same element. */
  expand(context: Context): WholeValue<Ordinary, Context>[] | null {
    const { getCustomProperty } = context;
    if (getCustomProperty === undefined) throw new InternalError('Shorthand substitution requires computed custom properties');
    const substituted = this.shorthand.value.substitute(getCustomProperty);
    return substituted instanceof GuaranteedInvalidValue ? null : this.shorthand.expand(substituted, context);
  }

  /** A pending longhand has no author-observable value before shorthand expansion. */
  override serialize(): string {
    return '';
  }
}

/** Retained shorthand syntax and its grammar, without element-specific computed state. */
export type PendingShorthand<Ordinary extends Value<Context>, Context extends PropertyContext = PropertyContext> = {
  name: string;
  value: SubstitutionValue;
  expand: (input: ParserInput, context: Context) => WholeValue<Ordinary, Context>[] | null;
};
