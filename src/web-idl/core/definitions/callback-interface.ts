import type {
  ConstantMember, Exposure, ExtendedAttribute, OperationMember, DeclarationCallback,
} from '../definition';

export type CallbackInterfaceDefinition<Realm = unknown> = {
  kind: 'callback-interface';
  name: string;
  members: CallbackInterfaceMember<Realm>[];
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
  // Project metadata: adapt the converted callback interface for implementation code.
  adapter?: {
    adapt: DeclarationCallback<'callback-interface-adapt', Realm>;
  };
};

// Project builder for Web IDL §2.4 Callback interfaces.
export function defineCallbackInterface<Realm = unknown>(
  definition: Omit<CallbackInterfaceDefinition<Realm>, 'kind'>,
): CallbackInterfaceDefinition<Realm> {
  return { kind: 'callback-interface', ...definition };
}

export type CallbackInterfaceMember<Realm = unknown> = ConstantMember | OperationMember<Realm>;
