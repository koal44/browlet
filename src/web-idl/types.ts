import type { ExtendedAttribute, WebIDLType } from './core/index';

/** Apply argument or dictionary-member conversion attributes to its declared type. */
// https://webidl.spec.whatwg.org/#idl-annotated-types
export function getTypeWithApplicableExtendedAttributes(
  type: WebIDLType,
  extendedAttributes: ExtendedAttribute[] | undefined,
): WebIDLType {
  const applicable = extendedAttributes?.filter((attribute) =>
    attribute.kind !== 'raw' &&
    typeExtendedAttributeNames.has(attribute.name)
  );
  if (!applicable || applicable.length === 0) return type;

  // Attributes written directly on a type precede applicable attributes from
  // its argument or dictionary-member production, while both precede any
  // attributes inherited through a typedef.
  if (type.kind === 'annotated') {
    return {
      ...type,
      type: getTypeWithApplicableExtendedAttributes(type.type, applicable),
    };
  }
  return { extendedAttributes: applicable, kind: 'annotated', type };
}

const typeExtendedAttributeNames = new Set([
  'AllowResizable',
  'AllowShared',
  'Clamp',
  'EnforceRange',
  'LegacyNullToEmptyString',
]);
