import { asciiLower } from '../../infra/ascii';

import {
  parseOptionalDeclarationValue, serializeComponentValues,
  type OptionalDeclarationValue, type Declaration,
} from '../syntax/index';
import { ValueStage } from '../value-processing/index';
import type {
  ColorContext, GradientContext, MathContext, PositionContext, ParsedSyntaxValue, SyntaxValue, UrlContext,
  WholeValue, WholeValueDefinition, SupportsContext,
} from '../values/index';
import {
  colorProperty, marginBottomProperty, marginLeftProperty, marginRightProperty, marginTopProperty,
  opacityProperty,
} from '../props/index';

export type PropertyDeclaration =
  | BuiltInPropertyDeclaration
  | CustomPropertyDeclaration;

export type BuiltInPropertyDeclaration = {
  [Name in PropertyName]: {
    type: 'property-declaration';
    custom: false;
    name: Name;
    value: PropertyValue<Name>;
    important: boolean;
  };
}[PropertyName];

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
  WholeValueFor<(typeof propertyRegistry)[Name]>;

type WholeValueFor<Definition> =
  Definition extends WholeValueDefinition<infer Value, infer Context>
    ? WholeValue<Value, Context>
    : never;

export type PropertyContext =
  & MathContext
  & ColorContext
  & GradientContext
  & PositionContext
  & UrlContext
  & SupportsContext;

export const propertyRegistry = {
  'background-color': colorProperty,
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
  initialValue: WholeValue<ParsedSyntaxValue, PropertyContext>;
};

export type CustomPropertyRegistry = ReadonlyMap<
  CustomPropertyName,
  CustomPropertyRegistration
>;

/** Interpret declarations in source order, discarding unsupported properties and invalid values. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#style-rules
// This helper applies property grammars to already-parsed declaration records.
export function interpretPropertyDeclarations(syntax: Declaration[]): PropertyDeclaration[] {
  const declarations: PropertyDeclaration[] = [];
  for (const item of syntax) {
    const declaration = interpretPropertyDeclaration(item);
    if (declaration !== null) declarations.push(declaration);
  }
  return declarations;
}

export function interpretPropertyDeclaration(
  declaration: Declaration,
): PropertyDeclaration | null {
  if (isCustomPropertyName(declaration.name)) {
    return interpretCustomPropertyDeclaration(declaration, declaration.name);
  }

  const name = asciiLower(declaration.name);
  if (!isPropertyName(name)) return null;

  return interpretBuiltInPropertyDeclaration(declaration, name);
}

export function serializePropertyDeclaration(
  declaration: PropertyDeclaration,
): SerializedPropertyDeclaration {
  if (declaration.custom) {
    return {
      name: declaration.name,
      value: declaration.originalText ??
        serializeComponentValues(declaration.value.components),
      important: declaration.important,
    };
  }

  return {
    name: declaration.name,
    value: declaration.value.serialize(),
    important: declaration.important,
  };
}

export function resolveBuiltInPropertyDeclaration(
  declaration: BuiltInPropertyDeclaration,
  stage: ValueStage,
  context: PropertyContext = {},
): BuiltInPropertyDeclaration | null {
  const value = declaration.value.resolve(stage, context);
  if (value === null) return null;

  // TypeScript does not preserve the correlation between a property name and
  // its value while resolving a union of built-in declarations.
  return { ...declaration, value } as BuiltInPropertyDeclaration;
}

function interpretCustomPropertyDeclaration(
  declaration: Declaration,
  name: CustomPropertyName,
): CustomPropertyDeclaration | null {
  const value = parseOptionalDeclarationValue(declaration.value);
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
): BuiltInPropertyDeclarationFor<Name> | null {
  const raw = propertyRegistry[name].parse(declaration.value);
  const value = raw?.resolve(ValueStage.Declared, {});

  if (value === null || value === undefined) return null;

  // TypeScript does not preserve the correlation between a generic registry
  // key and the value returned by that entry through indexed access.
  return {
    type: 'property-declaration',
    custom: false,
    name,
    value,
    important: declaration.important,
  } as BuiltInPropertyDeclarationFor<Name>;
}

type BuiltInPropertyDeclarationFor<Name extends PropertyName> =
  Extract<BuiltInPropertyDeclaration, { name: Name; }>;

function isPropertyName(name: string): name is PropertyName {
  return Object.hasOwn(propertyRegistry, name);
}

function isCustomPropertyName(name: string): name is CustomPropertyName {
  return name.startsWith('--');
}
