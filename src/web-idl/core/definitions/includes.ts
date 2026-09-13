import type { ExtendedAttribute } from '../definition';

export type IncludesDefinition = {
  kind: 'includes';
  interface: string;
  mixin: string;
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.3 Interface mixins — includes statements.
export function defineIncludes(
  definition: Omit<IncludesDefinition, 'kind'>,
): IncludesDefinition {
  return { kind: 'includes', ...definition };
}
