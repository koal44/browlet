import type { CustomPropertyName, ParserInput } from '../syntax/index';
import type { ValueContext } from '../value-processing/index';
import type { ParsedSyntaxValue, SyntaxValue, WholeValue } from '../values/index';
import type { PropertyContext } from './base-property';
import {
  backgroundColorProperty, colorProperty, marginProperty, marginTopProperty, marginRightProperty,
  marginBottomProperty, marginLeftProperty, opacityProperty,
} from './built-in/index';

// Type parameter: N = built-in property name.

export const builtInRegistry = {
  'background-color': backgroundColorProperty,
  color: colorProperty,
  margin: marginProperty,
  'margin-bottom': marginBottomProperty,
  'margin-left': marginLeftProperty,
  'margin-right': marginRightProperty,
  'margin-top': marginTopProperty,
  opacity: opacityProperty,
} as const;

/** Installed property records, retaining each entry's concrete type. */
export type BuiltInRegistry = typeof builtInRegistry;

/** Built-in property names installed in the registry, including shorthands. */
export type BuiltInPropertyName = keyof typeof builtInRegistry;

/** Whole-value family accepted by a supported built-in property. */
export type BuiltInPropertyValue<N extends BuiltInPropertyName> = BuiltInRegistry[N]['initialValue'];

/** Find either kind of built-in property using its normalized CSS name. */
export function getBuiltInProperty(name: string): BuiltInRegistry[BuiltInPropertyName] | undefined {
  return Object.hasOwn(builtInRegistry, name) ? builtInRegistry[name as BuiltInPropertyName] : undefined;
}

/** A document-scoped override of the Variables 1 defaults for one custom property. */
export type CustomPropertyRegistration = {
  name: CustomPropertyName;
  syntax: SyntaxValue;
  parse: (input: ParserInput, context: PropertyContext) => WholeValue<ParsedSyntaxValue> | null;
  inherits: boolean;
  initialValue: WholeValue<ParsedSyntaxValue>;
};

export type CustomPropertyRegistry = Map<CustomPropertyName, CustomPropertyRegistration>;

export interface RegistryContext extends ValueContext {
  /** Effective registrations for this computation; omitted in registration-free contexts. */
  customPropertyRegistry?: CustomPropertyRegistry;
}

/** Supported property names; interpretation expands shorthands before retaining declarations. */
export type PropertyName = BuiltInPropertyName | CustomPropertyName;
