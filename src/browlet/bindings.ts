import { encodingIDLDefinitions } from '../encoding/index';
import { fileIDLDefinitions } from '../file/index';
import { fetchIDLDefinitions } from '../fetch/index';
import { addon, type JSEnvironment } from '../js-engine/index';
import { styleletIDLDefinitions } from '../stylelet/index';
import { streamsIDLDefinitions } from '../streams/index';
import { urlIDLDefinitions, originIDL, serializeURL, type Origin, type URLRecord } from '../url/index';
import { xhrIDLDefinitions } from '../xhr/index';
import {
  BindingWorld, type GlobalObjectAllocation,
  type BindingContext, type StampedImplInstance, type StampedPlatformObject,
} from '../web-idl/index';
import { locationIDL } from './browsing/window/location';
import { referrerPolicyIDL } from './browsing/policy/referrer-policy';
import { integrityViolationReportBodyIDL } from './browsing/policy/integrity-policy';
import { coepViolationReportBodyIDL } from './browsing/policy/coep';
import { cspViolationReportBodyIDL } from './browsing/policy/csp/violation';
import {
  securityPolicyViolationEventIDL, securityPolicyViolationEventInitIDL,
  securityPolicyViolationEventDispositionIDL,
} from './browsing/policy/csp/violation-event';
import { reportIDL, reportBodyIDL } from './reporting/report';
import { testReportBodyIDL } from './reporting/test-report';
import {
  reportingObserverIDL, reportingObserverCallbackIDL, reportingObserverOptionsIDL, reportListIDL,
} from './reporting/observer';
import {
  WindowImpl, windowEventIDL, windowIDL, windowIncludesWindowOrWorkerGlobalScopeIDL,
} from './browsing/window/window';
import {
  adoptNativeWindowProxy, createWindowProxy, isWindowProxy,
  resolveWindowProxyReceiver, setWindowProxyWindow, type WindowProxy,
} from './browsing/window/window-proxy';
import { DocumentImpl, htmlDocumentIDL } from './dom/nodes/document';
import type { NodeImpl } from './dom/nodes/node';
import { domIDLDefinitions } from './dom/web-idl';
import { htmlIDLDefinitions } from './html/web-idl';
import { domExceptionCapabilities } from './integration/dom-exception';
import { fileCapabilities } from './integration/file/capabilities';
import { fetchCapabilities } from './integration/fetch';
import { fileReaderIDL } from './integration/file/file-reader';
import { objectURLIDL } from './integration/file/object-url';
import { createExecution } from './integration/execution';
import { mathMLIDLDefinitions } from './mathml/web-idl';
import {
  domHighResTimeStampIDL, epochTimeStampIDL, performanceIDL,
} from './performance/performance';
import type { WindowAgent } from './scripting/agents';
import { WindowEnvironment, createEnvironmentRecord, type EnvironmentRecord } from './scripting/environment';
import type { UserAgent } from './user-agent';
import { eventHandlerIDL, eventHandlerNonNullIDL } from './scripting/event-handlers';
import {
  highResolutionTimeWindowOrWorkerGlobalScopeIDL, timerHandlerIDL,
  windowOrWorkerGlobalScopeIDL, WindowOrWorkerGlobalScopeMixin,
} from './scripting/global-scope';
import { Realm, WindowRealm } from './scripting/realm';
import { structuredSerializeOptionsIDL } from './scripting/structured-data/web-idl';
import { svgIDLDefinitions } from './svg/web-idl';
import { InternalError } from '../infra/internal-error';

/*
 * The browser environment owns the final Web IDL assembly for its realm.
 * Defining specifications contribute declarations and implementation steps;
 * Browlet decides which contributions coexist and which initial objects are
 * installed on its Window environment. One main binding world spans the realms
 * hosted by Browlet's Node VM; it is not owned by an HTML Agent or AgentCluster.
 * These named entry points forward to the module's main BrowletBindings instance.
 */
export function createWindowEnvironment(
  initialization: WindowEnvironmentInit,
): WindowEnvironment {
  return browletBindings.createWindowEnvironment(initialization);
}

export function createDocument(realm: Realm): StampedImplInstance<DocumentImpl> {
  return browletBindings.createDocument(realm);
}

export function retargetWindowProxy(windowProxy: WindowProxy, window: WindowImpl): void {
  browletBindings.retargetWindowProxy(windowProxy, window);
}

/** Relevant realm of a browser object; Window and DOM-node inputs retain their concrete realm type. */
export function getRelevantRealm(value: Window | WindowImpl | Node | NodeImpl): WindowRealm;
export function getRelevantRealm(value: object): Realm;
export function getRelevantRealm(value: object): Realm {
  return browletBindings.getRelevantRealm(value);
}

export function project(value: object): StampedPlatformObject {
  return browletBindings.project(value);
}

export function unwrap<Value extends object>(value: object): StampedImplInstance<Value> {
  return browletBindings.unwrap<Value>(value);
}

export function registerRealm(
  realm: Realm,
  createEnvironment?: (context: BindingContext<Realm>) => JSEnvironment,
): BindingContext<Realm> {
  return browletBindings.register(realm, createEnvironment);
}

/** Retrieve the realm's context in Browlet's main binding world. */
export function getBindingContext(realm: Realm): BindingContext<Realm> {
  return browletBindings.forRealm(realm);
}

class BrowletBindings {
  #world: BindingWorld<Realm>;

  constructor() {
    this.#world = new BindingWorld<Realm>(
      browletDefinitions,
      {
        capabilities: browletCapabilities,
        hostDefinedInterfaces,
      },
    );
  }

  register(
    realm: Realm,
    createEnvironment: (context: BindingContext<Realm>) => JSEnvironment =
      (context) => ({ exec: createExecution(context) }),
  ): BindingContext<Realm> {
    return this.#world.register(realm, createEnvironment);
  }

  forRealm(realm: Realm): BindingContext<Realm> {
    const context = this.#world.forRealm(realm);
    if (!context) throw new InternalError('Realm has no Browlet binding');
    return context;
  }

  /* Compose the Window, its realm and bindings, and its browser environment. */
  createWindowEnvironment(
    initialization: WindowEnvironmentInit,
  ): WindowEnvironment {
    const {
      agent, userAgent, creationURL, origin, parent, topLevelCreationURL, topLevelOrigin,
      reservedEnv = null, previousRealm,
    } = initialization;
    // HTML secure-context determination; browser ancestry checks include the
    // parent's full chain. A reserved environment already carries that decision.
    // https://html.spec.whatwg.org/multipage/webappapis.html#secure-context
    // https://w3c.github.io/webappsec-secure-contexts/#ancestors
    const envRecord = reservedEnv ?? createEnvironmentRecord({
      userAgent, creationURL, topLevelCreationURL, topLevelOrigin,
      targetBrowsingContext: null,
      isSecureContext: userAgent.isOriginPotentiallyTrustworthy(origin) &&
        (parent === null || parent.isSecureContext),
    });
    const window = new WindowImpl(new URL(serializeURL(creationURL)));
    const useAddonGlobals = !!(
      addon.getMethod('createContextHandle') && addon.getMethod('runInContext') &&
      addon.getMethod('setPropertyDelegate') && addon.getMethod('setGlobalObject')
    );
    if (useAddonGlobals) previousRealm?.detachGlobal();
    const realm = new WindowRealm(window, {
      agent,
      envRecord,
      reuseGlobalProxyFrom: useAddonGlobals ? previousRealm : undefined,
      // Window.prototype -> named properties -> EventTarget.prototype.
      globalPrototypeChain: useAddonGlobals ? ['immutable', 'delegated', 'immutable'] : undefined,
    });
    // This new realm is registered exactly once; composition runs synchronously.
    let env!: WindowEnvironment;
    const context = this.#world.register(realm, (binding) => {
      // https://html.spec.whatwg.org/multipage/nav-history-apis.html#set-up-a-window-environment-settings-object
      // Execution reads the installed global lazily; all consumers retain this environment.
      env = new WindowEnvironment(realm, {
        ...envRecord, creationURL, topLevelCreationURL, topLevelOrigin,
      }, createExecution(binding));
      return env;
    });
    const chain = realm.globalPrototypeChain;
    let globalObject: Window;
    if (chain) {
      const [windowPrototype, namedProperties, eventTargetPrototype] = chain;
      const object = realm.allocatedGlobalObject;
      if (!object || !windowPrototype || !namedProperties || !eventTargetPrototype) {
        throw new InternalError('Incomplete native Window allocation');
      }
      // With add-on globals, supply the engine-allocated global object and prototypes to Web IDL.
      globalObject = projectWindow(context, window, {
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
      globalObject = projectWindow(context, window);
    }
    const globalThis = useAddonGlobals
      ? adoptNativeWindowProxy(realm.globalThis)
      : previousRealm?.globalThis ?? createWindowProxy();
    realm.setGlobalObjects(globalObject, globalThis);
    if (reservedEnv !== null) reservedEnv.id = '';
    window.setWindowOrWorkerGlobalScopeMixin(new WindowOrWorkerGlobalScopeMixin(env));
    return env;
  }

  createDocument(realm: Realm): StampedImplInstance<DocumentImpl> {
    return this.forRealm(realm).construct(DocumentImpl);
  }

  retargetWindowProxy(
    windowProxy: WindowProxy,
    window: WindowImpl,
  ): void {
    const windowObject = this.#world.project(window);
    if (!windowObject) throw new InternalError('Window has not been projected');
    setWindowProxyWindow(
      windowProxy,
      window,
      windowObject as StampedPlatformObject<Window>,
    );
  }

  getRelevantRealm(value: object): Realm {
    const realm = this.#world.getRealm(value) ?? Realm.getAssociatedRealm(value);
    if (!(realm instanceof Realm)) throw new InternalError('Object has no relevant Realm');
    return realm;
  }

  project(value: object): StampedPlatformObject {
    const object = this.#world.project(value);
    if (!object) throw new InternalError('Implementation has not been projected');
    return object;
  }

  unwrap<Value extends object>(value: object): StampedImplInstance<Value> {
    const implInst = this.#world.unwrap(value);
    if (!implInst) throw new InternalError('Value is not a platform object');
    return implInst as StampedImplInstance<Value>;
  }
}

type WindowEnvironmentInit = {
  agent: WindowAgent;
  userAgent: UserAgent;
  creationURL: URLRecord;
  origin: Origin;
  parent: WindowImpl | null;
  topLevelCreationURL: URLRecord;
  topLevelOrigin: Origin;
  reservedEnv?: EnvironmentRecord | null;
  previousRealm?: WindowRealm;
};

function projectWindow(
  context: BindingContext<Realm>,
  window: WindowImpl,
  allocation?: GlobalObjectAllocation,
): StampedPlatformObject<Window> {
  const object = context.projectGlobalObject(window, 'Window', allocation) as StampedPlatformObject<Window>;
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
  ...fetchCapabilities,
];

const browletDefinitions = [
  htmlDocumentIDL,
  ...htmlIDLDefinitions,
  ...svgIDLDefinitions,
  ...mathMLIDLDefinitions,
  originIDL,
  locationIDL,
  referrerPolicyIDL,
  reportIDL, reportBodyIDL, integrityViolationReportBodyIDL, testReportBodyIDL,
  coepViolationReportBodyIDL,
  cspViolationReportBodyIDL,
  securityPolicyViolationEventIDL, securityPolicyViolationEventInitIDL, securityPolicyViolationEventDispositionIDL,
  reportingObserverIDL, reportingObserverCallbackIDL, reportingObserverOptionsIDL, reportListIDL,
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
  objectURLIDL,
  ...xhrIDLDefinitions,
  ...urlIDLDefinitions,
  ...fetchIDLDefinitions,
];

const browletBindings = new BrowletBindings();
