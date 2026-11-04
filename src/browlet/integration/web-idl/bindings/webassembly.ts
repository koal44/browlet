import type { JSFunctionWithPrototype, JSMethod } from '../../../../js-engine/index';
import { PlatformRecordSource, type BindingContext } from '../../../../web-idl/index';

import { WasmModuleImpl } from '../../../webassembly/index';
import type { BrowletEnvironment } from '../../../environment/index';

/** Compose engine-owned errors and ModuleSource intrinsics with the ordinary Web IDL surface. */
// BINDING_INTEGRATION: ESM §5.1 changes the parent prototypes and source-kind recognition;
// it does not replace Module's constructor, member bindings, or platform-object allocation.
// https://webassembly.github.io/esm-integration/js-api/#modules
export function installWasmIntrinsics(context: BindingContext<BrowletEnvironment>): void {
  const { realm } = context;
  const namespace = Reflect.get(realm.globalObject, 'WebAssembly') as object;
  // ECMAScript supplies the NativeError constructors; these are not Web IDL interfaces.
  for (const name of ['CompileError', 'LinkError', 'RuntimeError']) {
    Object.defineProperty(namespace, name, { value: Reflect.get(realm.WebAssembly, name), writable: true, configurable: true });
  }
  // Private engine Promise resolution must not expose backing objects via author then getters.
  for (const constructor of [realm.WebAssemblyModule, realm.WebAssemblyInstance]) {
    Object.defineProperty(constructor.prototype, 'then', { value: undefined });
  }
  const prototype = context.getPlatformObjectPrototype(context.resolveInterface(WasmModuleImpl));
  const constructor = Reflect.get(prototype, 'constructor') as JSFunctionWithPrototype;
  const source = Object.getPrototypeOf(realm.WebAssemblyModule) as JSFunctionWithPrototype;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoked below with the explicit source-object receiver.
  const nativeKind = Object.getOwnPropertyDescriptor(source.prototype, Symbol.toStringTag)!.get as JSMethod;
  Object.setPrototypeOf(constructor, source);
  Object.setPrototypeOf(prototype, source.prototype);
  Object.defineProperty(source.prototype, Symbol.toStringTag, {
    configurable: true,
    get: realm.createFunction((receiver) => context.getPlatformRecord(receiver, PlatformRecordSource.Platform)?.implInst instanceof WasmModuleImpl
      ? 'WebAssembly.Module' : Reflect.apply(nativeKind, receiver, []),
    { name: 'get [Symbol.toStringTag]', length: 0 }),
  });
}
