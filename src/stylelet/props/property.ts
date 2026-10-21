import { asciiLower } from '../../infra/ascii';

import {
  parseOptionalDeclarationValue, serializeComponentValues,
  type OptionalDeclarationValue, type Declaration,
} from '../syntax/index';
import type { ValueStage } from '../value-processing/index';
import type {
  ColorContext, GradientContext, MathContext, PositionContext, ParsedSyntaxValue, SyntaxValue, UrlContext,
  WholeValue, WholeValueDefinition, SupportsContext,
} from '../values/index';

import { backgroundColorProperty, colorProperty } from './color';
import { opacityProperty } from './opacity';
import { marginBottomProperty, marginLeftProperty, marginRightProperty, marginTopProperty } from './margin';

/** Shared built-in property record; its registry key supplies the name. */
export type PropertyRecord<Value, Context> = {
  definition: WholeValueDefinition<Value, Context>;
  /** Whether defaulting inherits the parent's computed value. */
  inherits: boolean;
  /** Shared Declared representation; resolution must leave this value unchanged. */
  initialValue: WholeValue<Value>;
};

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

export type PropertyValue<Name extends PropertyName> =
  WholeValue<PropertyData[Name]>;

type PropertyData = {
  [Name in PropertyName]: ValueFor<(typeof propertyRegistry)[Name]>;
};

type ValueFor<Property> =
  Property extends PropertyRecord<infer Value, PropertyContext>
    ? Value
    : never;

// This mapped view keeps each registry key paired with its value type during
// generic lookup. It describes the existing registry, not another registration.
type PropertyRecords = {
  [Name in PropertyName]: PropertyRecord<PropertyData[Name], PropertyContext>;
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
  'margin-bottom': marginBottomProperty,
  'margin-left': marginLeftProperty,
  'margin-right': marginRightProperty,
  'margin-top': marginTopProperty,
  opacity: opacityProperty,
} as const;

export type PropertyName = keyof typeof propertyRegistry;

export type CustomPropertyName = `--${string}`;

export type CustomPropertyRegistration = {
  name: CustomPropertyName;
  syntax: SyntaxValue;
  definition: WholeValueDefinition<ParsedSyntaxValue, PropertyContext>;
  inherits: boolean;
  initialValue: WholeValue<ParsedSyntaxValue>;
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
    const declaration = interpretPropertyDeclaration(item, context);
    if (declaration !== null) declarations.push(declaration);
  }
  return declarations;
}

export function interpretPropertyDeclaration(
  declaration: Declaration,
  context: PropertyContext,
): PropertyDeclaration | null {
  if (isCustomPropertyName(declaration.name)) {
    return interpretCustomPropertyDeclaration(declaration, declaration.name, context);
  }

  const name = asciiLower(declaration.name);
  if (!isPropertyName(name)) return null;

  return interpretBuiltInPropertyDeclaration(declaration, name, context);
}

export function serializePropertyDeclaration<Name extends PropertyName>(
  declaration: PropertyDeclaration<Name>,
): SerializedPropertyDeclaration {
  if (declaration.custom) {
    return {
      name: declaration.name,
      value: declaration.originalText ??
        serializeComponentValues(declaration.value.components.tokens),
      important: declaration.important,
    };
  }

  const property: PropertyRecords[Name] = propertyRegistry[declaration.name];
  return {
    name: declaration.name,
    value: property.definition.serialize(declaration.value),
    important: declaration.important,
  };
}

export function resolveBuiltInPropertyDeclaration<Name extends PropertyName>(
  declaration: BuiltInPropertyDeclaration<Name>,
  stage: ValueStage,
  context: PropertyContext = {},
): BuiltInPropertyDeclaration<Name> {
  const property: PropertyRecords[Name] = propertyRegistry[declaration.name];
  const value = property.definition.resolve(declaration.value, stage, context);

  return { ...declaration, value };
}

function interpretCustomPropertyDeclaration(
  declaration: Declaration,
  name: CustomPropertyName,
  context: PropertyContext,
): CustomPropertyDeclaration | null {
  const value = parseOptionalDeclarationValue(declaration.value, context);
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
  const value = property.definition.parse(declaration.value, context);

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
  return name.startsWith('--');
}
