import { InternalError } from '../../infra/internal-error';

import type { ParserInput } from '../syntax/index';
import {
  CssWideValue, OptionalDeclarationValue, SubstitutionValue,
  FirstValidValue, type WholeValue, type WholeValueContents, type Value, type PendingShorthand,
} from '../values/index';
import type { PropertyContext } from './base-property';
import type { BuiltInProperty } from './builtin-property';
import type { BuiltInPropertyName } from './registry';

// Type parameter: O = ordinary longhand value.

/** Shared shorthand handling around a family's ordinary grammar and serialization. */
export abstract class Shorthand<O extends Value = Value> {
  /** Normalized CSS name, retained by pending occurrences. */
  name: string;
  /** Longhands in canonical order, including reset-only properties. */
  longhands: BuiltInProperty<O, BuiltInPropertyName>[];

  constructor(
    name: string,
    longhands: Shorthand<O>['longhands'],
  ) {
    this.name = name;
    this.longhands = longhands;
  }

  /** Parse into longhand order; the declaration owner supplies names and importance. */
  // https://drafts.csswg.org/css-cascade-5/#shorthand
  expand(input: ParserInput, context: PropertyContext): WholeValue<O>[] | null {
    const declValue = OptionalDeclarationValue.parse(input, context);
    if (declValue === null || !SubstitutionValue.hasValidVarArguments(declValue.repr)) return null;
    if (FirstValidValue.parse(declValue.repr, context) !== null) {
      // TODO: Select a first-valid() argument against the complete shorthand grammar.
      // https://drafts.csswg.org/css-values-5/#first-valid
      throw new InternalError(`First-valid ${this.name} shorthand selection is not implemented`);
    }
    if (SubstitutionValue.containsFunction(declValue.repr)) {
      // https://drafts.csswg.org/css-values-5/#substitution-in-shorthands
      const shorthand: PendingShorthand<O> = {
        name: this.name,
        value: new SubstitutionValue(declValue),
        expand: (input, context) => this.expand(input, context),
      };
      return this.longhands.map((property, shorthandIndex) => property.createPendingValue(shorthand, shorthandIndex));
    }

    const cssWide = CssWideValue.parse(declValue.repr, context);
    if (cssWide !== null) return this.longhands.map((property) => property.createValue(cssWide));
    const values = this.parseValues(declValue.repr, context);
    return values === null ? null : this.longhands.map((property, index) => property.createValue(values[index]!));
  }

  /** Serialize complete, equally important longhands, or empty text if incompatible. */
  // https://drafts.csswg.org/cssom/#serialize-into-a-shorthand-form
  serialize(propValues: WholeValue[]): string {
    const pending = propValues[0];
    if (pending?.isPendingSubstitution()) {
      return pending.shorthand.name === this.name &&
        propValues.every((propValue) => propValue.isPendingSubstitution() && propValue.shorthand === pending.shorthand)
        ? pending.shorthand.value.serialize()
        : '';
    }
    const keyword = propValues[0]?.cssWideKeyword();
    if (keyword !== undefined) return propValues.every((propValue) => propValue.cssWideKeyword() === keyword) ? keyword : '';
    return this.serializeValues(propValues.map(({ inner }) => inner));
  }

  /** Parse ordinary shorthand syntax into exactly one value per canonical longhand. */
  protected abstract parseValues(input: ParserInput, context: PropertyContext): O[] | null;

  /** Shorten compatible ordinary values; reject deferred notation or incompatible value families. */
  protected abstract serializeValues(values: WholeValueContents<Value>[]): string;
}
