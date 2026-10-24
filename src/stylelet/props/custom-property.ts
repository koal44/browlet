import { InternalError } from '../../infra/internal-error';

import type { CustomPropertyName, ParserInput } from '../syntax/index';
import { ValueStage } from '../value-processing/index';
import {
  guaranteedInvalidValue, OptionalDeclarationValue, SubstitutionValue,
  WholeValue, RawWholeValue,
} from '../values/index';
import { BaseProperty, type PropertyContext } from './base-property';

// Type parameter: N = custom property name.

/** A named member of the --* family; registrations are selected at computation time. */
// https://drafts.csswg.org/css-variables-1/#defining-variables
export class CustomProperty<N extends CustomPropertyName = CustomPropertyName> extends BaseProperty<CustomPropertyValue, N> {
  static initialValue = new WholeValue<OptionalDeclarationValue>(guaranteedInvalidValue, OptionalDeclarationValue.parse);

  custom = true as const;
  inherits = true;
  initialValue = CustomProperty.initialValue;
  animationType = 'discrete' as const;
  percentages = 'not-applicable' as const;
  resolvedValueStage = ValueStage.Computed as const;

  /** Custom properties apply to every element and pseudo-element, including restricted pseudos. */
  appliesTo(_context: PropertyContext): boolean {
    return true;
  }

  /** Registered and unregistered custom properties accept the same declaration-time grammar. */
  // https://drafts.css-houdini.org/css-properties-values-api-1/#parse-time-behavior
  parse(input: ParserInput, context: PropertyContext): CustomPropertyValue | null {
    const declValue = OptionalDeclarationValue.parse(input, context);
    return declValue === null || !SubstitutionValue.hasValidVarArguments(declValue.repr) ? null :
      new WholeValue<OptionalDeclarationValue>(new RawWholeValue(declValue), OptionalDeclarationValue.parse);
  }

  /** Substitute components; the caller owns dependency guards, CSS-wide defaulting, and inheritance. */
  resolve(propValue: CustomPropertyValue, stage: ValueStage, context: PropertyContext): CustomPropertyValue {
    if (stage < ValueStage.Computed) return propValue;
    const registration = context.customPropertyRegistry?.get(this.name);
    if (registration !== undefined) {
      // TODO: Apply registered syntax, inherits, initial value, and computational independence.
      throw new InternalError('Registered custom-property computation is not implemented');
    }
    return propValue.resolve(stage, context);
  }

  /** Preserve custom-property spelling at the retained stage. */
  // https://drafts.csswg.org/css-variables-1/#serializing-custom-props
  serialize(propValue: CustomPropertyValue): string {
    // SPEC_CLASH(css-custom-property-boundary-comments): Preserve surrounding comments
    // as required by Variables; browsers discard leading/comment-only comments.
    // SPEC_CLASH(custom-property-value-escapes): Preserve source spelling as required
    // by CSS Variables and Chromium/Firefox; WebKit serializes decoded tokens.
    // SPEC_CLASH(empty-custom-property-serialization): Follow CSS Variables' single
    // space for an empty value; all three browsers return the empty string instead.
    // SPEC_CLASH(custom-property-eof-serialization): Preserve source spelling, including
    // missing EOF delimiters, as in Chromium. Firefox completes them; WebKit's behavior varies.
    if (propValue.isGuaranteedInvalid()) return '';
    const inner = propValue.inner;
    return (inner instanceof OptionalDeclarationValue ? inner.repr.sourceText() : propValue.serialize()) || ' ';
  }

  interpolate(from: CustomPropertyValue, to: CustomPropertyValue, progress: number, context: PropertyContext): CustomPropertyValue {
    this.#requireUnregistered(context);
    return progress < 0.5 ? from : to;
  }

  add(_underlying: CustomPropertyValue, effect: CustomPropertyValue, context: PropertyContext): CustomPropertyValue {
    this.#requireUnregistered(context);
    return effect;
  }

  accumulate(underlying: CustomPropertyValue, effect: CustomPropertyValue, context: PropertyContext): CustomPropertyValue {
    return this.add(underlying, effect, context);
  }

  #requireUnregistered(context: PropertyContext): void {
    if (context.customPropertyRegistry?.has(this.name)) {
      // TODO: Derive combination from registered syntax after registered computation is implemented.
      throw new InternalError('Registered custom-property animation is not implemented');
    }
  }
}

/** A complete custom value, retaining opaque components or whole-value notation. */
export type CustomPropertyValue = WholeValue<OptionalDeclarationValue>;
