import { InternalError } from '../../infra/internal-error';

import { createComponentParser, repeat, withTrivia, type ParserInput, type TryConsumer } from '../syntax/index';
import {
  CssWideValue, FirstValidValue, OptionalDeclarationValue, SubstitutionValue,
  type PendingShorthand, type Value, type WholeValue,
} from '../values/index';
import type { PropertyContext } from './base-property';
import type { BuiltInProperty } from './builtin-property';

// Type parameter: O = ordinary longhand value.

/** Parsing, expansion, and shortening shared by properties with the same shorthand pattern. */
export abstract class Shorthand<O extends Value = Value> {
  /** Longhands in canonical order, including reset-only properties. */
  longhands: BuiltInProperty<O>[];

  constructor(longhands: BuiltInProperty<O>[]) {
    this.longhands = longhands;
  }

  /** Link the owning property to these longhands in CSSOM's preferred shorthand order. */
  // https://drafts.csswg.org/cssom/#concept-shorthands-preferred-order
  attach(property: BuiltInProperty): void {
    const rank = property.name.startsWith('-webkit-') ? 1 : property.name.startsWith('-') ? 2 : 0;
    const follows = (other: BuiltInProperty): boolean => {
      const otherRank = other.name.startsWith('-webkit-') ? 1 : other.name.startsWith('-') ? 2 : 0;
      const order = other.shorthand!.longhands.length - this.longhands.length || rank - otherRank;
      return order < 0 || (order === 0 && property.name < other.name);
    };
    for (const longhand of this.longhands) {
      const containing = longhand.containingShorthands;
      const index = containing.findIndex(follows);
      containing.splice(index < 0 ? containing.length : index, 0, property);
    }
  }

  /** Parse shorthand syntax for interpretation or deferred reparsing with the current context. */
  // https://drafts.csswg.org/css-cascade-5/#shorthand
  parse(input: ParserInput, context: PropertyContext, name: string): WholeValue<O>[] | null {
    const declValue = OptionalDeclarationValue.parse(input, context);
    if (declValue === null || !SubstitutionValue.hasValidVarArguments(declValue.repr)) return null;
    if (FirstValidValue.parse(declValue.repr, context) !== null) {
      // TODO: Select a first-valid() argument against the complete shorthand grammar.
      // https://drafts.csswg.org/css-values-5/#first-valid
      throw new InternalError(`First-valid ${name} shorthand selection is not implemented`);
    }
    if (SubstitutionValue.containsFunction(declValue.repr)) {
      // https://drafts.csswg.org/css-values-5/#substitution-in-shorthands
      const pending: PendingShorthand<O> = {
        name, value: new SubstitutionValue(declValue),
        expand: (input, context) => this.parse(input, context, name),
      };
      return this.longhands.map((property, shorthandIndex) => property.createPendingValue(pending, shorthandIndex));
    }
    const cssWide = CssWideValue.parse(declValue.repr, context);
    if (cssWide !== null) return this.longhands.map((property) => property.createValue(cssWide));
    const values = this.parseLonghands(declValue.repr, context);
    return values === null ? null : this.longhands.map((property, index) => property.createValue(values[index]!));
  }

  /** Shorten ordinary longhand text already serialized by the owning properties. */
  abstract serialize(text: string[]): string;

  /** Parse ordinary shorthand syntax into exactly one value per canonical longhand. */
  protected abstract parseLonghands(input: ParserInput, context: PropertyContext): O[] | null;
}

/** One through four values in top/right/bottom/left order, omitting repeated sides. */
export class FourSidesShorthand<O extends Value> extends Shorthand<O> {
  #parseValues: (input: ParserInput, context: PropertyContext) => [O, ...O[]] | null;

  constructor(
    longhands: [BuiltInProperty<O>, BuiltInProperty<O>, BuiltInProperty<O>, BuiltInProperty<O>],
    consume: TryConsumer<O, PropertyContext>,
  ) {
    super(longhands);
    this.#parseValues = createComponentParser(repeat(withTrivia(consume), 1, 4));
  }

  serialize(text: string[]): string {
    let count = 4;
    if (text[3] === text[1]) {
      count = 3;
      if (text[2] === text[0]) {
        count = 2;
        if (text[1] === text[0]) count = 1;
      }
    }
    return text.slice(0, count).join(' ');
  }

  protected parseLonghands(input: ParserInput, context: PropertyContext): O[] | null {
    const values = this.#parseValues(input, context);
    if (values === null) return null;
    const [top, right = top, bottom = top, left = right] = values;
    return [top, right, bottom, left];
  }
}
