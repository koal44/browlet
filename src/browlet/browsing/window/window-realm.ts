import { browletBindings, projectWindow } from '../../bindings';
import type { WindowAgent } from '../../scripting/agents';
import { Realm, type JavaScriptExecutionContext } from '../../scripting/realm';
import type { WindowImpl } from './window';
import { createWindowRuntime } from '../../integration/runtime';
import { adoptNativeWindowProxy, createWindowProxy } from './window-proxy';

/*
 * Compose the engine's global allocation with the Window binding. Navigation
 * keeps the native proxy while allocating a new Window and prototype chain.
 */
export function createWindowRealm(
  agent: WindowAgent,
  window: WindowImpl,
  previousRealm?: Realm,
): JavaScriptExecutionContext {
  const native = Realm.supportsGlobalPrototypeChain;
  if (native) previousRealm?.detachGlobal();
  const realm = new Realm({
    agent,
    reuseGlobalProxyFrom: native ? previousRealm : undefined,
    // Window.prototype -> named properties -> EventTarget.prototype.
    globalPrototypeChain: native ? ['immutable', 'delegated', 'immutable'] : undefined,
  });
  const bindings = browletBindings.register(realm, {
    createRuntime: (context) => createWindowRuntime(realm, window, context),
  });
  const chain = realm.globalPrototypeChain;
  let globalObject: Window;
  if (chain) {
    const [windowPrototype, namedProperties, eventTargetPrototype] = chain;
    const object = realm.allocatedGlobalObject;
    if (!object || !windowPrototype || !namedProperties || !eventTargetPrototype) {
      throw new Error('Incomplete native Window allocation');
    }
    globalObject = projectWindow(bindings, window, {
      object,
      prototypes: new Map([
        ['Window', windowPrototype],
        ['EventTarget', eventTargetPrototype],
      ]),
      namedProperties: {
        object: namedProperties,
        setDelegate: (delegate) => { realm.setPropertyDelegate(namedProperties, delegate); },
      },
    });
  } else {
    globalObject = projectWindow(bindings, window);
  }
  const globalThis = native
    ? adoptNativeWindowProxy(realm.globalThis)
    : previousRealm?.globalThis ?? createWindowProxy();
  Realm.setGlobalObjects(realm, globalObject, globalThis, window);
  return { realm };
}
