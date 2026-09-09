import { nodeRuntime as runtime } from './node-runtime';
import type { JavaScriptRuntime } from './realm';

export { NodeRealm, type NodeRealmOptions } from './node-realm';
export const nodeRuntime: JavaScriptRuntime = runtime;
export * from './abstract-operations';
export * from './array-buffer-primitives';
export * from './built-in-primitives';
export * from './promise-operations';
export * from './simple-exception';
export type {
  GlobalObject, JavaScriptBufferViewName, JavaScriptFunction, JavaScriptIntrinsics,
  JavaScriptHostHooks, JavaScriptJobCallback, JavaScriptJobRegistration,
  JavaScriptMethod, JavaScriptMicrotaskQueue, JavaScriptRealm,
  JavaScriptRuntime, RealmFunctionOptions, RealmFunctionSteps,
} from './realm';
