import type { AttributeFunctionSteps } from './core/index';

import type { WebIDLEnvironment, WebIDLRealm } from './environment';
import type { IDLCallbackInterface } from './values/index';
import type { BindingContext } from './binding/context';

export * from './core/index';

export type { BindingContext };
export { BindingWorld } from './binding/world';
export type { WebIDLEnvironment, WebIDLRealm };
export type { CallbackHooks, SecurityCheckType } from './environment';
export type { GlobalObjectAllocation } from './binding/realm';
export {
  isStampedImplInstance, isStampedPlatformObject,
  type StampedImplInstance, type StampedPlatformObject, type PlatformRecord,
} from './binding/platform';

// The full Web IDL entry supplies typed Binding Contexts for declaration hooks.
declare module './core/types' {
  interface DeclarationHooks<Env, Impl extends object, Values extends unknown[]> {
    'argument-resolve': BindingHook<Env, void, [method: BindingContext<Env & WebIDLEnvironment>], unknown>;
    'initialize-implementation': BindingHook<Env, undefined, [value: Impl], void>;
    'constructor-create': BindingHook<Env, undefined, Values, object>;
    'constructor-invoke': BindingHook<Env, object, Values, void>;
    'attribute-get': BindingHook<Env, object | null, [], unknown>;
    'attribute-set': BindingHook<Env, object | null, [value: unknown], void>;
    'attribute-function': BindingHook<Env, undefined, [], AttributeFunctionSteps>;
    'operation-invoke': BindingHook<Env, object | null, Values, unknown>;
    'callback-interface-to-impl': BindingHook<
      Env, undefined, [cbValue: IDLCallbackInterface<(Env & WebIDLEnvironment)['realm']>], unknown
    >;
  }
}

/** A declaration hook receiving its typed Binding Context before the hook-specific arguments. */
type BindingHook<Env, This, Values extends unknown[], Result> = (
  this: This,
  ctx: BindingContext<Env & WebIDLEnvironment>,
  ...values: Values
) => Result;
