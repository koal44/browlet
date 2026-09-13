import type {
  AttributeMember, ConstantMember, Exposure, ExtendedAttribute, OperationMember,
} from '../definition';

export type NamespaceDefinition<Realm = unknown> = {
  kind: 'namespace';
  name: string;
  members: NamespaceMember<Realm>[];
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.6 Namespaces.
export function defineNamespace<Realm = unknown>(
  definition: Omit<NamespaceDefinition<Realm>, 'kind'>,
): NamespaceDefinition<Realm> {
  return { kind: 'namespace', ...definition };
}

export type PartialNamespaceDefinition<Realm = unknown> = {
  kind: 'partial-namespace';
  name: string;
  members: NamespaceMember<Realm>[];
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.6 Namespaces — partial namespace definitions.
export function definePartialNamespace<Realm = unknown>(
  definition: Omit<PartialNamespaceDefinition<Realm>, 'kind'>,
): PartialNamespaceDefinition<Realm> {
  return { kind: 'partial-namespace', ...definition };
}

export type NamespaceMember<Realm = unknown> = ConstantMember | AttributeMember<Realm> | OperationMember<Realm>;
