import { asciiLower } from '../../../infra/ascii';
import { nonASCIIWhitespacePattern } from '../../../infra/patterns';

import {
  parseDeclarationList, parseListOfComponentValues, serializeCssIdentifier, type Declaration, type ParserInput,
} from '../../syntax/index';
import type { ValueStage } from '../../value-processing/index';
import { OptionalDeclarationValue } from '../../values/index';
import {
  getShorthand, propertyRegistry, type CustomPropertyName, type PropertyContext, type PropertyName, type PropertyValue,
} from '../../props/index';

/** An occurrence whose property grammar has been applied; later value resolution may remain deferred. */
// https://drafts.csswg.org/cssom/#css-declarations
// Currently covers built-in and custom properties; descriptor interpretation remains unfinished.
// The instance union below preserves narrowing by property name without wrapping these fields.
export const InterpretedDeclaration = class <Name extends DeclarationName> {
  /** Normalized built-in name or case-sensitive custom property name. */
  name: Name;
  /** Value parsed using this property's grammar. */
  value: DeclarationValues[Name];
  /** Whether the occurrence has an !important annotation. */
  important: boolean;
  /** Whether the property retains opaque custom-property components. */
  custom: Name extends CustomPropertyName ? true : false;

  constructor(name: Name, value: NoInfer<DeclarationValues[Name]>, important = false) {
    this.name = name;
    this.value = value;
    this.important = important;
    this.custom = name.startsWith('--') as typeof this.custom;
  }

  /** Interpret one syntax declaration into longhands or one custom property; null rejects its grammar. */
  // https://drafts.csswg.org/css-cascade-5/#shorthand
  static interpret(declaration: Declaration, context: PropertyContext): InterpretedDeclaration[] | null {
    const { name, important } = declaration;
    if (isCustomPropertyName(name)) {
      const value = OptionalDeclarationValue.parse(declaration.value, context);
      return value === null ? null : [new InterpretedDeclaration(name, value, important)];
    }

    const property = asciiLower(name);
    const shorthand = getShorthand(property);
    if (shorthand !== undefined) return shorthand.expand(declaration, context);
    if (!isPropertyName(property)) return null;

    const value = propertyRegistry[property].parse(declaration.value, context);
    // Both fields came from the same registry entry; preserve that correlation in the instance union.
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

  /** Serialize the value alone, reading custom-property spelling from its retained source. */
  // https://drafts.csswg.org/css-variables-1/#serializing-custom-props
  serializeValue(): string {
    const value = this.value;
    // SPEC_CLASH(custom-property-value-escapes): Preserve source spelling as required
    // by CSS Variables and Chromium/Firefox; WebKit serializes decoded tokens.
    // SPEC_CLASH(empty-custom-property-serialization): Follow CSS Variables' single
    // space for an empty value; all three browsers return the empty string instead.
    return value instanceof OptionalDeclarationValue ? value.value.sourceText() || ' ' : value.serialize();
  }

  /** Serialize this complete declaration at its current value stage. */
  serialize(): string {
    return InterpretedDeclaration.serializeText(this.name, this.serializeValue(), this.important);
  }

  /** Resolve with fresh context, leaving the source occurrence unchanged. */
  resolve(stage: ValueStage, context: PropertyContext = {}): InterpretedDeclaration<Name> {
    const value = this.value.resolve(stage, context);
    return new InterpretedDeclaration(
      this.name, value as DeclarationValues[Name], this.important,
    );
  }

  /** Whether the other property maps the same logical group differently. */
  // https://drafts.csswg.org/css-logical-1/#logical-property-group
  hasDifferentMapping(other: InterpretedDeclaration): boolean {
    if (!isPropertyName(this.name) || other.custom) return false;
    const left = propertyRegistry[this.name].logicalGroup;
    const right = propertyRegistry[other.name].logicalGroup;
    return left !== undefined && right !== undefined && left.name === right.name && left.mapping !== right.mapping;
  }
};

/** Keep each name paired with its value, including when an array contains different properties. */
// TODO: Reassess this coupling and its TypeScript cost; see ROADMAP.md#declaration-typing.
export type InterpretedDeclaration<Name extends DeclarationName = DeclarationName> = {
  [Key in Name]: InstanceType<typeof InterpretedDeclaration<Key>>;
}[Name];

export type BuiltInDeclaration<Name extends PropertyName = PropertyName> = InterpretedDeclaration<Name>;
export type CustomDeclaration = InterpretedDeclaration<CustomPropertyName>;

type DeclarationName = PropertyName | CustomPropertyName;
type DeclarationValues = { [Name in PropertyName]: PropertyValue<Name>; } & {
  [Name in CustomPropertyName]: OptionalDeclarationValue;
};

function isPropertyName(name: string): name is PropertyName {
  return Object.hasOwn(propertyRegistry, name);
}

function isCustomPropertyName(name: string): name is CustomPropertyName {
  // https://drafts.csswg.org/css-variables-1/#defining-variables
  // The bare -- name is reserved and is not a custom property.
  return name.length > 2 && name.startsWith('--');
}
