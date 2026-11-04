import { getCreationRealm, isWebAssemblyException, type JSFunction } from '../../../../js-engine/index';
import { createOverloadResolver, PlatformRecordSource, type RealmBinding } from '../../../../web-idl/index';

import { WasmExceptionImpl } from '../../../webassembly/index';
import type { BrowletEnvironment } from '../../../environment/index';

/** Install Web IDL on the prototype V8 itself uses when a Wasm instruction throws. */
// BINDING_INTEGRATION: Exceptions can reach author code without a platform call.
// Keep their native identity and typed payload, with a separate implementation.
// Only this interface's entries associate engine-created receivers; ordinary
// record lookup and exported Wasm functions remain unchanged.
// https://webassembly.github.io/spec/js-api/#exceptions
export function installWasmExceptionBinding(binding: RealmBinding<BrowletEnvironment>): void {
  const { realm } = binding;
  const assembled = binding.resolveInterface(WasmExceptionImpl);
  const implementation = binding.getImplementationBinding(assembled);
  const prototype = realm.WebAssemblyException.prototype;
  const constructors = assembled.getConstructors((entry) => assembled.isMemberExposed(entry, realm));
  const resolve = createOverloadResolver(constructors, binding, 'Exception:constructor');

  // Reuse the ordinary constructor's conversion and implementation steps. The
  // only different allocation is the platform object: use the native backing
  // instead of a fresh ordinary object, so throwing it into Wasm still works.
  implementation.overrideConstructor = (argumentsList, newTarget) => {
    if (!newTarget) return binding.throwTypeError("Failed to construct 'Exception': use the 'new' operator.");
    const overload = resolve(argumentsList);
    const selectedPrototype = binding.getPlatformObjectPrototype(assembled, newTarget);
    const behavior = binding.getMemberBinding(assembled, overload.callable)!.constructorBehavior!;
    // Exception declares a constructing implementation, not initialization steps.
    const construct = behavior.steps as (values: unknown[]) => WasmExceptionImpl;
    const implInst = construct(overload.values);
    const exception = implInst.getBacking();
    Object.setPrototypeOf(exception, selectedPrototype);
    return binding.associate(WasmExceptionImpl, implInst).attachPlatformObject(exception);
  };

  // This runs before global installation. V8 retains its original constructor
  // and this prototype; replacing the public namespace property alone would
  // leave engine-thrown exceptions on a different prototype.
  implementation.interfacePrototypeObject = prototype;
  implementation.defineOperations(prototype, 'regular');
  implementation.defineAttributes(prototype, 'regular');
  for (const name of ['is', 'getArg', 'stack']) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name)!;
    const getter = name === 'stack';
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoked below with the validated explicit receiver.
    const method = (getter ? descriptor.get : descriptor.value) as JSFunction;
    const entry = realm.createFunction((receiver, argumentsList) => {
      let invocationReceiver = receiver;
      if (!binding.getPlatformRecord(receiver, PlatformRecordSource.Platform) && isWebAssemblyException(receiver)) {
        const creationRealm = getCreationRealm(receiver);
        const owner = creationRealm && binding.getBindingContext(creationRealm);
        const implInst = new WasmExceptionImpl(receiver, [], { traceStack: false }, (owner ?? binding).getEnvironment());
        if (owner) {
          owner.associate(WasmExceptionImpl, implInst).attachPlatformObject(receiver);
        } else {
          // ACCOMMODATION(stock-node): Without exact creation-realm information,
          // use a private, temporary receiver for the generated Web IDL method.
          // Do not stamp the native exception with a guessed permanent owner.
          // The native object returned to author code is never replaced.
          invocationReceiver = binding.project(WasmExceptionImpl, implInst);
        }
      }
      return Reflect.apply(method, invocationReceiver, argumentsList);
    }, { name: method.name, length: method.length });
    Object.defineProperty(prototype, name, getter ? { ...descriptor, get: entry } : { ...descriptor, value: entry });
  }
  Object.defineProperty(prototype, 'constructor', {
    value: implementation.getInterfaceObject(), writable: true, configurable: true,
  });
  Object.defineProperty(prototype, Symbol.toStringTag, {
    value: assembled.getQualifiedName(), configurable: true,
  });
}
