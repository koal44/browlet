import type { BindingContext } from '../../../../web-idl/index';

import type { BrowletEnvironment } from '../../../environment/index';

/** Compose engine-owned errors with the ordinary Web IDL surface. */
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
}
