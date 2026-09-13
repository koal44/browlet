import type { ExtendedAttribute, WebIDLType } from '../definition';

export type TypedefDefinition = {
  kind: 'typedef';
  name: string;
  type: WebIDLType;
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.11 Typedefs.
export function defineTypedef(
  definition: Omit<TypedefDefinition, 'kind'>,
): TypedefDefinition {
  return { kind: 'typedef', ...definition };
}
