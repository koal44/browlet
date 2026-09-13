import type { BindingContext } from './binding-context';
import type { AttributeFunctionCallback } from './binding';
import type { CallbackInterfaceValue } from './callback-value';
import type { WebIDLRealmHost } from './js-realm';

export * from './core/index';

export {
  DOMExceptionImpl, QuotaExceededErrorImpl, domExceptionIDL,
  quotaExceededErrorIDL, quotaExceededErrorOptionsIDL,
} from './dom-exception';
export { endOfIteration, type AsyncSequenceValue } from './async-sequence';

export type { BindingContext };
export {
  defineCapability, type Capability, type CapabilityRegistration,
  type CapabilityOptions,
} from './capability';
export { createBindingWorld } from './registration';
export type {
  BindingWorld, BindingWorldOptions, RealmRegistrationOptions,
} from './registration';
export type { WebIDLRealmHost };
export type { GlobalObjectAllocation } from './binding';

// Project typing: the full Web IDL entry supplies contextual callback types for declarations.
declare module './core/definition' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface DeclarationCallbacks<Realm> {
    'argument-resolve': (ctx: BindingContext<Realm & WebIDLRealmHost>) => unknown;
    'allocate-platform-object': BindingCallback<Realm, undefined, [prototype: object], object>;
    'initialize-implementation': BindingCallback<Realm, undefined, [value: object], void>;
    'constructor-create': BindingCallback<Realm, undefined, unknown[], object>;
    'constructor-invoke': BindingCallback<Realm, object, unknown[], void>;
    'attribute-get': BindingCallback<Realm, object | null, [], unknown>;
    'attribute-set': BindingCallback<Realm, object | null, [value: unknown], void>;
    'attribute-function': BindingCallback<Realm, undefined, [], AttributeFunctionCallback>;
    'operation-invoke': BindingCallback<Realm, object | null, unknown[], unknown>;
    'callback-interface-adapt': BindingCallback<
      Realm, undefined, [value: CallbackInterfaceValue], unknown
    >;
  }
}

type BindingCallback<Realm, This, Values extends unknown[], Result> = (
  this: This,
  ctx: BindingContext<Realm & WebIDLRealmHost>,
  ...values: Values
) => Result;
