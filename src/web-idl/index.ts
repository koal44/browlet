import type { BindingContext } from './binding/context';
import type { AttributeFunctionCallback } from './binding/member';
import type { CallbackInterfaceCarrier } from './constructs/callback';
import type { WebIDLEnvironment, WebIDLRealm } from './environment';

export * from './core/index';

export { endOfIteration, type AsyncSequenceValue } from './constructs/async-sequence';

export type { BindingContext };
export type { AssembledInterface } from './assembled';
export { BindingWorld } from './binding/world';
export type { WebIDLEnvironment, WebIDLRealm };
export type { CallbackHooks, SecurityCheckType } from './environment';
export type { GlobalObjectAllocation } from './binding/realm';
export {
  isStampedImplInstance, isStampedPlatformObject,
  type StampedImplInstance, type StampedPlatformObject, type PlatformRecord,
} from './binding/platform-object';

// Project typing: the full Web IDL entry supplies contextual callback types for declarations.
declare module './core/types' {
  interface DeclarationCallbacks<Env, Impl extends object, Values extends unknown[]> {
    'argument-resolve': BindingCallback<Env, void, [method: BindingContext<Env & WebIDLEnvironment>], unknown>;
    'initialize-implementation': BindingCallback<Env, undefined, [value: Impl], void>;
    'constructor-create': BindingCallback<Env, undefined, Values, object>;
    'constructor-invoke': BindingCallback<Env, object, Values, void>;
    'attribute-get': BindingCallback<Env, object | null, [], unknown>;
    'attribute-set': BindingCallback<Env, object | null, [value: unknown], void>;
    'attribute-function': BindingCallback<Env, undefined, [], AttributeFunctionCallback>;
    'operation-invoke': BindingCallback<Env, object | null, Values, unknown>;
    'callback-interface-to-impl': BindingCallback<
      Env, undefined, [cbCarrier: CallbackInterfaceCarrier<(Env & WebIDLEnvironment)['realm']>], unknown
    >;
  }
}

/** A declaration hook receiving its typed Binding Context before the hook-specific arguments. */
type BindingCallback<Env, This, Values extends unknown[], Result> = (
  this: This,
  ctx: BindingContext<Env & WebIDLEnvironment>,
  ...values: Values
) => Result;
