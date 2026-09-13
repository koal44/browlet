import type { ExtendedAttribute } from '../definition';

export type EnumerationDefinition = {
  kind: 'enumeration';
  name: string;
  values: string[];
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.9 Enumerations.
export function defineEnumeration(
  definition: Omit<EnumerationDefinition, 'kind'>,
): EnumerationDefinition {
  return { kind: 'enumeration', ...definition };
}
