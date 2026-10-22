import { InternalError } from '../../infra/internal-error';

import type { ParserInput } from '../syntax/index';
import {
  CssWideValue, OptionalDeclarationValue, SubstitutionValue, PendingSubstitutionValue,
  FirstValidValue, type WholeValue, type Value, type PendingShorthand,
} from '../values/index';
import type { PropertyContext, PropertyRecord } from './property';
import type { BuiltInPropertyName } from './registry';

/** Shared shorthand handling around a family's ordinary grammar and serialization. */
export abstract class Shorthand<Ordinary extends Value = Value> {
  /** Normalized CSS name, retained by pending occurrences. */
  name: string;
  /** Longhands in canonical order, including reset-only properties. */
  longhands: Array<[name: BuiltInPropertyName, property: PropertyRecord<Ordinary>]>;

  constructor(
    name: string,
    longhands: Shorthand<Ordinary>['longhands'],
  ) {
    this.name = name;
    this.longhands = longhands;
  }

  /** Parse into longhand order; the declaration owner supplies names and importance. */
  // https://drafts.csswg.org/css-cascade-5/#shorthand
  expand(input: ParserInput, context: PropertyContext): WholeValue<Ordinary>[] | null {
    const declaration = OptionalDeclarationValue.parse(input, context);
    if (declaration === null || !SubstitutionValue.hasValidVarArguments(declaration.value)) return null;
    if (FirstValidValue.parse(declaration.value, context) !== null) {
      // TODO: Select a first-valid() argument against the complete shorthand grammar.
      // https://drafts.csswg.org/css-values-5/#first-valid
      throw new InternalError(`First-valid ${this.name} shorthand selection is not implemented`);
    }
    if (SubstitutionValue.containsFunction(declaration.value)) {
      // https://drafts.csswg.org/css-values-5/#substitution-in-shorthands
      const shorthand: PendingShorthand<Ordinary> = {
        name: this.name,
        value: new SubstitutionValue(declaration),
        expand: (input, context) => this.expand(input, context),
      };
      return this.longhands.map(([, property], index) => property.createPendingValue(shorthand, index));
    }

    const cssWide = CssWideValue.parse(declaration.value, context);
    if (cssWide !== null) return this.longhands.map(([, property]) => property.createValue(cssWide));
    const values = this.parseValues(declaration.value, context);
    return values === null ? null : this.longhands.map(([, property], index) => property.createValue(values[index]!));
  }

  /** Serialize complete, equally important longhands, or empty text if incompatible. */
  // https://drafts.csswg.org/cssom/#serialize-into-a-shorthand-form
  serialize(values: WholeValue<Value>[]): string {
    const pending = values[0];
    if (pending instanceof PendingSubstitutionValue) {
      return pending.shorthand.name === this.name &&
        values.every((value) => value instanceof PendingSubstitutionValue && value.shorthand === pending.shorthand)
        ? pending.shorthand.value.serialize()
        : '';
    }
    const components = values.map(({ value }) => value);
    const first = components[0]!;
    if (first instanceof CssWideValue) {
      return components.every((value) => value instanceof CssWideValue && value.value === first.value)
        ? first.serialize()
        : '';
    }
    return this.serializeValues(components);
  }

  /** Parse ordinary shorthand syntax into exactly one value per canonical longhand. */
  protected abstract parseValues(input: ParserInput, context: PropertyContext): Ordinary[] | null;

  /** Shorten compatible ordinary values; reject deferred notation or incompatible value families. */
  protected abstract serializeValues(values: WholeValue<Value>['value'][]): string;
}
