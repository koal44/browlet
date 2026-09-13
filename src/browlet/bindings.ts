import { encodingIDLDefinitions } from '../encoding/index';
import { fileIDLDefinitions } from '../file/index';
import { addon } from '../js-engine/index';
import { styleletIDLDefinitions } from '../stylelet/web-idl';
import { streamsIDLDefinitions } from '../streams/index';
import { urlIDLDefinitions } from '../url/api';
import { originIDL } from '../url/origin-api';
import { xhrIDLDefinitions } from '../xhr/index';
import {
  createBindings, type BindingWorld, type RealmBindingOptions, type RealmBindings,
  type GlobalObjectAllocation,
} from '../web-idl/index';
import { locationIDL } from './browsing/window/location';
import {
  type WindowImpl, windowEventIDL, windowIDL, windowIncludesWindowOrWorkerGlobalScopeIDL,
} from './browsing/window/window';
import {
  adoptNativeWindowProxy, createWindowProxy, isWindowProxy,
  resolveWindowProxyReceiver, setWindowProxyWindow, type WindowProxy,
} from './browsing/window/window-proxy';
import { DocumentImpl, htmlDocumentIDL } from './dom/nodes/document';
import { domIDLDefinitions } from './dom/web-idl';
import { htmlIDLDefinitions } from './html/web-idl';
import { domExceptionCapabilities } from './integration/dom-exception';
import { fileCapabilities } from './integration/file/capabilities';
import { fileReaderIDL } from './integration/file/file-reader';
import {
  createStructuredClone as createStructuredCloneSteps, createWindowRuntime,
} from './integration/runtime';
import { xhrCapabilities } from './integration/xhr';
import { mathMLIDLDefinitions } from './mathml/web-idl';
import {
  domHighResTimeStampIDL, epochTimeStampIDL, performanceIDL,
} from './performance/performance';
import type { WindowAgent } from './scripting/agents';
import { eventHandlerIDL, eventHandlerNonNullIDL } from './scripting/event-handlers';
import {
  highResolutionTimeWindowOrWorkerGlobalScopeIDL, timerHandlerIDL,
  windowOrWorkerGlobalScopeIDL, type StructuredCloneSteps,
} from './scripting/global-scope';
import { Realm, type JSExecutionContext } from './scripting/realm';
import { structuredSerializeOptionsIDL } from './scripting/structured-data/web-idl';
import { svgIDLDefinitions } from './svg/web-idl';

/*
 * The browser environment owns the final Web IDL assembly for its realm.
 * Defining specifications contribute declarations and implementation steps;
 * Browlet decides which contributions coexist and which initial objects are
 * installed on its Window environment. One main binding world spans the realms
 * hosted by Browlet's Node VM; it is not owned by an HTML Agent or AgentCluster.
 * These named entry points forward to the module's main BrowletBindings instance.
 */
export function createWindowRealm(
  agent: WindowAgent,
  window: WindowImpl,
  previousRealm?: Realm,
): JSExecutionContext {
  return browletBindings.createWindowRealm(agent, window, previousRealm);
}

export function createDocument(realm: Realm): DocumentImpl {
  return browletBindings.createDocument(realm);
}

export function createStructuredClone(realm: Realm): StructuredCloneSteps {
  return browletBindings.createStructuredClone(realm);
}

export function retargetWindowProxy(windowProxy: WindowProxy, window: WindowImpl): void {
  browletBindings.retargetWindowProxy(windowProxy, window);
}

export function getRelevantRealm(value: object): Realm {
  return browletBindings.getRelevantRealm(value);
}

export function getPlatformObject(value: object): object {
  return browletBindings.getPlatformObject(value);
}

export function getImplementation<Value extends object>(value: object): Value {
  return browletBindings.getImplementation<Value>(value);
}

export function registerRealm(realm: Realm, options?: RealmBindingOptions): RealmBindings {
  return browletBindings.register(realm, options);
}

export function getRealmBindings(realm: Realm): RealmBindings {
  return browletBindings.forRealm(realm);
}

class BrowletBindings {
  readonly #world: BindingWorld;

  constructor() {
    this.#world = createBindings(
      browletDefinitions,
      {
        capabilities: browletCapabilities,
        hostDefinedInterfaces,
      },
    );
  }

  register(realm: Realm, options: RealmBindingOptions = {}): RealmBindings {
    return this.#world.register(realm, options);
  }

  forRealm(realm: Realm): RealmBindings {
    const bindings = this.#world.forRealm(realm);
    if (!bindings) throw new Error('Realm has no Browlet binding');
    return bindings;
  }

  /* Compose engine allocation and bindings for the Window selected by HTML. */
  createWindowRealm(
    agent: WindowAgent,
    window: WindowImpl,
    previousRealm?: Realm,
  ): JSExecutionContext {
    const useAddonGlobals = !!(
      addon.getMethod('createContextHandle') && addon.getMethod('runInContext') &&
      addon.getMethod('setPropertyDelegate') && addon.getMethod('setGlobalObject')
    );
    if (useAddonGlobals) previousRealm?.detachGlobal();
    const realm = new Realm({
      agent,
      reuseGlobalProxyFrom: useAddonGlobals ? previousRealm : undefined,
      // Window.prototype -> named properties -> EventTarget.prototype.
      globalPrototypeChain: useAddonGlobals ? ['immutable', 'delegated', 'immutable'] : undefined,
    });
    const bindings = this.register(realm, {
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
    const globalThis = useAddonGlobals
      ? adoptNativeWindowProxy(realm.globalThis)
      : previousRealm?.globalThis ?? createWindowProxy();
    Realm.setGlobalObjects(realm, globalObject, globalThis, window);
    return { realm };
  }

  createDocument(realm: Realm): DocumentImpl {
    const { context } = this.forRealm(realm);
    const document = context.construct(DocumentImpl);
    // Eager projection also installs EventTarget's realm-owned event factory.
    context.project(DocumentImpl, document);
    return document;
  }

  createStructuredClone(realm: Realm): StructuredCloneSteps {
    return createStructuredCloneSteps(realm, this.forRealm(realm).context);
  }

  retargetWindowProxy(
    windowProxy: WindowProxy,
    window: WindowImpl,
  ): void {
    const windowObject = this.#world.getPlatformObject(window);
    if (!windowObject) throw new Error('Window has not been projected');
    setWindowProxyWindow(
      windowProxy,
      window,
      windowObject as Window,
    );
  }

  getRelevantRealm(value: object): Realm {
    const platformRealm = this.#world.getRealm(value);
    if (platformRealm instanceof Realm) return platformRealm;

    const realm = Realm.getAssociatedRealm(value);
    if (!realm) throw new Error('Object has no relevant Realm');
    return realm;
  }

  getPlatformObject(value: object): object {
    const object = this.#world.getPlatformObject(value);
    if (!object) throw new Error('Implementation has not been projected');
    return object;
  }

  getImplementation<Value extends object>(value: object): Value {
    const implementation = this.#world.getImplementationObject(value);
    if (!implementation) throw new Error('Value is not a platform object');
    return implementation as Value;
  }
}

function projectWindow(
  bindings: RealmBindings,
  window: WindowImpl,
  allocation?: GlobalObjectAllocation,
): Window {
  const object = bindings.projectGlobalObject(window, 'Window', allocation) as Window;
  // Preserve the provisional CSSOM operation until Stylelet supplies its
  // Window partial and CSSStyleDeclaration projection (see WindowImpl).
  Object.defineProperty(object, 'getComputedStyle', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: window.getComputedStyle,
  });
  return object;
}

const hostDefinedInterfaces = [{
  is: isWindowProxy,
  name: 'WindowProxy',
  resolveReceiver: resolveWindowProxyReceiver,
}];

const browletCapabilities = [
  ...domExceptionCapabilities,
  ...fileCapabilities,
  ...xhrCapabilities,
];

const browletDefinitions = [
  htmlDocumentIDL,
  ...htmlIDLDefinitions,
  ...svgIDLDefinitions,
  ...mathMLIDLDefinitions,
  originIDL,
  locationIDL,
  domHighResTimeStampIDL,
  epochTimeStampIDL,
  performanceIDL,
  eventHandlerNonNullIDL,
  eventHandlerIDL,
  structuredSerializeOptionsIDL,
  timerHandlerIDL,
  windowOrWorkerGlobalScopeIDL,
  highResolutionTimeWindowOrWorkerGlobalScopeIDL,
  windowIDL,
  windowEventIDL,
  windowIncludesWindowOrWorkerGlobalScopeIDL,
  ...domIDLDefinitions,
  ...styleletIDLDefinitions,
  ...streamsIDLDefinitions,
  ...encodingIDLDefinitions,
  ...fileIDLDefinitions,
  fileReaderIDL,
  ...xhrIDLDefinitions,
  ...urlIDLDefinitions,
];

const browletBindings = new BrowletBindings();
