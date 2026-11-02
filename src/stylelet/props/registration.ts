import type { CustomPropertyName, ParserInput } from '../syntax/index';
import type { ValueContext } from '../value-processing/index';
import type { ParsedSyntaxValue, SyntaxValue, WholeValue } from '../values/index';

import type { PropertyContext } from './base-property';

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
