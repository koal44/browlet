import type {
  AttributeMember, ConstantMember, Exposure, ExtendedAttribute, OperationMember, StringifierMember,
} from '../definition';

export type InterfaceMixinDefinition<Realm = unknown> = {
  kind: 'interface-mixin';
  name: string;
  members: MixinMember<Realm>[];
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.3 Interface mixins.
export function defineInterfaceMixin<Realm = unknown>(
  definition: Omit<InterfaceMixinDefinition<Realm>, 'kind'>,
): InterfaceMixinDefinition<Realm> {
  return { kind: 'interface-mixin', ...definition };
}

export type PartialInterfaceMixinDefinition<Realm = unknown> = {
  kind: 'partial-interface-mixin';
  name: string;
  members: MixinMember<Realm>[];
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

// Project builder for Web IDL §2.3 Interface mixins — partial interface mixin definitions.
export function definePartialInterfaceMixin<Realm = unknown>(
  definition: Omit<PartialInterfaceMixinDefinition<Realm>, 'kind'>,
): PartialInterfaceMixinDefinition<Realm> {
  return { kind: 'partial-interface-mixin', ...definition };
}

export type MixinMember<Realm = unknown> =
  | ConstantMember
  | AttributeMember<Realm>
  | OperationMember<Realm>
  | StringifierMember;
