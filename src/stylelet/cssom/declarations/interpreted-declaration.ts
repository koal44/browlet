import { asciiLower } from '../../../infra/ascii';
import { nonASCIIWhitespacePattern } from '../../../infra/patterns';

import {
  isCustomPropertyName, parseDeclarationList, parseListOfComponentValues, serializeCssIdentifier,
  type SyntaxDeclaration, type ParserInput,
} from '../../syntax/index';
import type { WholeValue } from '../../values/index';
import {
  getShorthand, propertyRegistry, CustomProperty, type BuiltInPropertyName, type CustomPropertyName,
  type BaseProperty, type PropertyContext, type PropertyName,
} from '../../props/index';

// Type parameters: P = property record, W = accepted whole value, N/K = property name.

/** An occurrence whose property grammar has been applied; later value resolution may remain deferred. */
// https://drafts.csswg.org/cssom/#css-declarations
// Currently covers built-in and custom properties; descriptor interpretation remains unfinished.
// The instance union below preserves narrowing by property name without wrapping these fields.
class Declaration<P extends BaseProperty<W, PropertyName>, W extends WholeValue> {
  /** Named property identified during interpretation. */
  property: P;
  /** Retained value; replace the declaration rather than mutate its value or nested payload. */
  value: W;
  /** Whether the occurrence has an !important annotation. */
  important: boolean;

  /** Computed only on a text request, for this declaration's retained value. */
  #serializedValue?: string;

  constructor(property: P & BaseProperty<W, PropertyName>, value: W, important = false) {
    this.property = property;
    this.value = value;
    this.important = important;
  }

  /** Interpret one syntax declaration into longhands or one custom property; null rejects its grammar. */
  // https://drafts.csswg.org/css-cascade-5/#shorthand
  static interpret(declaration: SyntaxDeclaration, context: PropertyContext): InterpretedDeclaration[] | null {
    const { name, important } = declaration;
    if (isCustomPropertyName(name)) {
      const property = new CustomProperty(name);
      const value = property.parse(declaration.value, context);
      if (value === null) return null;
      const interpreted = new InterpretedDeclaration(property, value, important);
      return [interpreted];
    }

    const normalizedName = asciiLower(name);
    const shorthand = getShorthand(normalizedName);
    if (shorthand !== undefined) {
      const values = shorthand.expand(declaration.value, context);
      return values === null ? null : values.map((value, index) =>
        new InterpretedDeclaration(shorthand.longhands[index]!, value, important) as BuiltInDeclaration,
      );
    }
    if (!isBuiltInPropertyName(normalizedName)) return null;

    const property = propertyRegistry[normalizedName];
    const value = property.parse(declaration.value, context);
    // Property and value came from the same registry entry; preserve their correlation in the instance union.
    return value === null ? null : [new InterpretedDeclaration(property, value, important) as BuiltInDeclaration];
  }

  /** Parse a property's value with a decoded name and a separately supplied priority. */
  // Part of https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-setproperty
  static parse(name: string, value: string, important: boolean, context: PropertyContext): InterpretedDeclaration[] | null {
    // Parse only the value: punctuation in the decoded name must not become CSS syntax,
    // and trailing semicolons or embedded !important must fail the value's grammar.
    // https://drafts.csswg.org/cssom/#parse-a-css-value
    const list = parseListOfComponentValues(value, context);
    list.trimWhitespace();
    return InterpretedDeclaration.interpret({ name, value: list, important }, context);
  }

  /** Parse supported property declarations without interpreting nested style rules. */
  // https://drafts.csswg.org/cssom/#parse-a-css-declaration-block
  // TODO: retain per-declaration parse-time URL bases when URL-valued properties are registered.
  static parseBlock(input: ParserInput, context: PropertyContext): InterpretedDeclaration[] {
    const declarations: InterpretedDeclaration[] = [];
    for (const syntax of parseDeclarationList(input, context)) {
      const interpreted = InterpretedDeclaration.interpret(syntax, context);
      if (interpreted !== null) declarations.push(...interpreted);
    }
    return declarations;
  }

  /** Format a property name, an already serialized value, and its priority, including shorthand output. */
  // https://drafts.csswg.org/cssom/#serialize-a-css-declaration
  static serializeText(name: string, value: string, important: boolean): string {
    // SPEC_CLASH(custom-property-name-serialization): Follow Chromium/Firefox by
    // escaping decoded custom names; CSSOM's literal steps and WebKit emit them raw.
    const property = name.startsWith('--') ? serializeCssIdentifier(name) : name;
    const text = nonASCIIWhitespacePattern.test(value) ? value : '';
    return `${property}: ${text}${important ? ' !important' : ''};`;
  }

  /** Normalized built-in name or case-sensitive custom property name, supplied by its owner. */
  get name(): P['name'] {
    return this.property.name;
  }

  /** Preserve declaration narrowing without storing a second property discriminator. */
  get custom(): P['custom'] {
    return this.property.custom;
  }

  /** Serialize the value alone, reading custom-property spelling from its retained source. */
  // https://drafts.csswg.org/css-variables-1/#serializing-custom-props
  serializeValue(): string {
    return this.#serializedValue ??= this.property.serialize(this.value);
  }

  /** Serialize this complete declaration at its current value stage. */
  serialize(): string {
    return InterpretedDeclaration.serializeText(this.name, this.serializeValue(), this.important);
  }

  /** Whether the other property maps the same logical group differently. */
  // https://drafts.csswg.org/css-logical-1/#logical-property-group
  hasDifferentMapping(other: InterpretedDeclaration): boolean {
    const left = this.property.logicalGroup;
    const right = other.property.logicalGroup;
    return left !== undefined && right !== undefined && left.name === right.name && left.mapping !== right.mapping;
  }
}

// A named class lets TypeScript emit its private cache while the exported type retains the union.
export const InterpretedDeclaration = Declaration;

/** Keep each name paired with its value, including when an array contains different properties. */
// TODO: Reassess this coupling and its TypeScript cost; see ROADMAP.md#declaration-typing.
export type InterpretedDeclaration<N extends PropertyName = PropertyName> = {
  [K in N]: Declaration<DeclarationProperties[K], DeclarationProperties[K]['initialValue']>;
}[N];

export type BuiltInDeclaration<N extends BuiltInPropertyName = BuiltInPropertyName> = InterpretedDeclaration<N>;
export type CustomDeclaration = InterpretedDeclaration<CustomPropertyName>;

type DeclarationProperties = typeof propertyRegistry & {
  [N in CustomPropertyName]: CustomProperty<N>;
};

function isBuiltInPropertyName(name: string): name is BuiltInPropertyName {
  return Object.hasOwn(propertyRegistry, name);
}
