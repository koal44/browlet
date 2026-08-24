import type { DefinitionAssembly } from './adapter/assembly';
import type {
  AnnotatedType, ExtendedAttribute, UnionType, WebIDLType,
} from './adapter/definition';

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

export function getFlattenedMemberTypes(
  type: UnionType | AnnotatedUnionType,
  definitions: DefinitionAssembly,
): WebIDLType[] {
  const unionType = type.kind === 'annotated' ? type.type : type;
  const flattenedMemberTypes: WebIDLType[] = [];

  for (let memberType of unionType.types) {
    memberType = getUnannotatedType(memberType, definitions);
    if (memberType.kind === 'nullable') {
      memberType = getUnannotatedType(memberType.type, definitions);
    }
    if (memberType.kind === 'union') {
      flattenedMemberTypes.push(
        ...getFlattenedMemberTypes(memberType, definitions),
      );
    } else {
      flattenedMemberTypes.push(memberType);
    }
  }

  return flattenedMemberTypes;
}

export function getNumberOfNullableMemberTypes(
  type: UnionType | AnnotatedUnionType,
  definitions: DefinitionAssembly,
): number {
  const unionType = type.kind === 'annotated' ? type.type : type;
  let numberOfNullableMemberTypes = 0;

  for (let memberType of unionType.types) {
    memberType = getUnannotatedType(memberType, definitions);
    if (memberType.kind === 'nullable') {
      numberOfNullableMemberTypes++;
      memberType = getUnannotatedType(memberType.type, definitions);
    }
    if (memberType.kind === 'union') {
      numberOfNullableMemberTypes += getNumberOfNullableMemberTypes(
        memberType,
        definitions,
      );
    }
  }

  return numberOfNullableMemberTypes;
}

export function includesNullableType(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): boolean {
  const innerType = getUnannotatedType(type, definitions);
  if (innerType.kind === 'nullable') return true;
  return innerType.kind === 'union' &&
    getNumberOfNullableMemberTypes(innerType, definitions) === 1;
}

export function includesUndefined(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): boolean {
  const innerType = getUnannotatedType(type, definitions);
  if (
    innerType.kind === 'simple' &&
    innerType.name === 'undefined'
  ) return true;
  if (innerType.kind === 'nullable') {
    return includesUndefined(innerType.type, definitions);
  }
  if (innerType.kind === 'union') {
    return innerType.types.some(
      (memberType) => includesUndefined(memberType, definitions),
    );
  }
  return false;
}

export function getUnannotatedType(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): WebIDLType {
  let innerType = resolveTypedef(type, definitions);
  while (innerType.kind === 'annotated') {
    innerType = resolveTypedef(innerType.type, definitions);
  }
  return innerType;
}

export function resolveTypedef(
  type: WebIDLType,
  definitions: DefinitionAssembly,
): WebIDLType {
  let resolvedType = type;
  while (resolvedType.kind === 'reference') {
    const definition = definitions.getDefinition(resolvedType.name);
    if (definition?.kind !== 'typedef') break;
    resolvedType = definition.type;
  }
  return resolvedType;
}

type AnnotatedUnionType = AnnotatedType & { type: UnionType; };

const typeExtendedAttributeNames = new Set([
  'AllowResizable',
  'AllowShared',
  'Clamp',
  'EnforceRange',
  'LegacyNullToEmptyString',
]);
