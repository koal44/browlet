import { asciiLower } from '../../infra/ascii';

import type { Declaration, ParserInput } from '../syntax/index';
import type { ValueStage } from '../value-processing/index';
import {
  OptionalDeclarationValue,
  type Value, type ColorContext, type GradientContext, type MathContext, type PositionContext,
  type ParsedSyntaxValue, type SyntaxValue, type UrlContext, type WholeValue, type SupportsContext,
} from '../values/index';

import { backgroundColorProperty, colorProperty } from './color';
import { opacityProperty } from './opacity';
import { marginSideProperty } from './margin';
import { getShorthand } from './shorthand';

/** Shared built-in property record; its registry key supplies the name. */
export type PropertyRecord<Ordinary extends Value<Context>, Context> = {
  /** Shared parser for this property's ordinary grammar and whole-value notation. */
  parse: (input: ParserInput, context: Context) => WholeValue<Ordinary, Context> | null;
  /** Whether defaulting inherits the parent's computed value. */
  inherits: boolean;
  /** Shared Declared representation; resolution must leave this value unchanged. */
  initialValue: WholeValue<Ordinary, Context>;
  /** Group and mapping used to preserve order between physical and logical properties. */
  logicalGroup?: { name: string; mapping: 'physical' | 'logical'; };
};

/** CSS declaration data; custom distinguishes case-sensitive names from normalized built-ins. */
// https://drafts.csswg.org/cssom/#css-declarations
// Built-in values are interpreted value instances rather than retained syntax tokens.
export type PropertyDeclaration<Name extends PropertyName = PropertyName> =
  | BuiltInPropertyDeclaration<Name>
  | CustomPropertyDeclaration;

export type BuiltInPropertyDeclaration<Name extends PropertyName = PropertyName> = {
  [Key in Name]: {
    type: 'property-declaration';
    custom: false;
    name: Key;
    value: PropertyValue<Key>;
    important: boolean;
  };
}[Name];

export type CustomPropertyDeclaration = {
  type: 'property-declaration';
  custom: true;
  name: CustomPropertyName;
  value: OptionalDeclarationValue;
  important: boolean;
  originalText?: string;
};

export type SerializedPropertyDeclaration = {
  name: string;
  value: string;
  important: boolean;
};

export type PropertyValue<Name extends PropertyName> = PropertyValues[Name];

type PropertyValues = {
  [Name in PropertyName]: NonNullable<ReturnType<(typeof propertyRegistry)[Name]['parse']>>;
};

// This mapped view keeps each registry key paired with its value type during
// generic lookup. It describes the existing registry, not another registration.
type PropertyRecords = {
  [Name in PropertyName]: { parse: (input: ParserInput, context: PropertyContext) => PropertyValue<Name> | null; };
};

export type PropertyContext =
  & MathContext
  & ColorContext
  & GradientContext
  & PositionContext
  & UrlContext
  & SupportsContext;

export const propertyRegistry = {
  'background-color': backgroundColorProperty,
  color: colorProperty,
  'margin-bottom': marginSideProperty,
  'margin-left': marginSideProperty,
  'margin-right': marginSideProperty,
  'margin-top': marginSideProperty,
  opacity: opacityProperty,
} as const;

export type PropertyName = keyof typeof propertyRegistry;

export type CustomPropertyName = `--${string}`;

export type CustomPropertyRegistration = {
  name: CustomPropertyName;
  syntax: SyntaxValue;
  parse: (input: ParserInput, context: PropertyContext) => WholeValue<ParsedSyntaxValue, PropertyContext> | null;
  inherits: boolean;
  initialValue: WholeValue<ParsedSyntaxValue, PropertyContext>;
};

export type CustomPropertyRegistry = ReadonlyMap<
  CustomPropertyName,
  CustomPropertyRegistration
>;

/** Interpret declarations in source order, discarding unsupported properties and invalid values. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#style-rules
// This helper applies property grammars to already-parsed declaration records.
export function interpretPropertyDeclarations(
  syntax: Declaration[],
  context: PropertyContext,
): PropertyDeclaration[] {
  const declarations: PropertyDeclaration[] = [];
  for (const item of syntax) {
    const expanded = interpretPropertyDeclaration(item, context);
    if (expanded !== null) declarations.push(...expanded);
  }
  return declarations;
}

/** Interpret a declaration into longhands or one custom property; null rejects its grammar. */
// https://drafts.csswg.org/css-cascade-5/#shorthand
export function interpretPropertyDeclaration(
  declaration: Declaration,
  context: PropertyContext,
): PropertyDeclaration[] | null {
  if (isCustomPropertyName(declaration.name)) {
    const custom = interpretCustomPropertyDeclaration(declaration, declaration.name, context);
    return custom === null ? null : [custom];
  }

  const name = asciiLower(declaration.name);
  const shorthand = getShorthand(name);
  if (shorthand !== undefined) return shorthand.expand(declaration, context);
  if (!isPropertyName(name)) return null;

  const builtIn = interpretBuiltInPropertyDeclaration(declaration, name, context);
  return builtIn === null ? null : [builtIn];
}

export function serializePropertyDeclaration<Name extends PropertyName>(
  declaration: PropertyDeclaration<Name>,
): SerializedPropertyDeclaration {
  const originalText = declaration.custom ? declaration.originalText : undefined;

  return {
    name: declaration.name,
    value: originalText ?? declaration.value.serialize(),
    important: declaration.important,
  };
}

export function resolveBuiltInPropertyDeclaration<Name extends PropertyName>(
  declaration: BuiltInPropertyDeclaration<Name>,
  stage: ValueStage,
  context: PropertyContext = {},
): BuiltInPropertyDeclaration<Name> {
  const value = declaration.value.resolve(stage, context);

  return { ...declaration, value };
}

function interpretCustomPropertyDeclaration(
  declaration: Declaration,
  name: CustomPropertyName,
  context: PropertyContext,
): CustomPropertyDeclaration | null {
  const value = OptionalDeclarationValue.parse(declaration.value, context);
  if (value === null) return null;

  return {
    type: 'property-declaration',
    custom: true,
    name,
    value,
    important: declaration.important,
    ...(declaration.originalText === undefined
      ? {}
      : { originalText: declaration.originalText }),
  };
}

function interpretBuiltInPropertyDeclaration<Name extends PropertyName>(
  declaration: Declaration,
  name: Name,
  context: PropertyContext,
): BuiltInPropertyDeclaration<Name> | null {
  const property: PropertyRecords[Name] = propertyRegistry[name];
  const value = property.parse(declaration.value, context);

  if (value === null) return null;

  return {
    type: 'property-declaration',
    custom: false,
    name,
    value,
    important: declaration.important,
  };
}

function isPropertyName(name: string): name is PropertyName {
  return Object.hasOwn(propertyRegistry, name);
}

function isCustomPropertyName(name: string): name is CustomPropertyName {
  // https://drafts.csswg.org/css-variables-1/#defining-variables
  // The bare -- name is reserved and is not a custom property.
  return name.length > 2 && name.startsWith('--');
}
