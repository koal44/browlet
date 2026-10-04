import { InternalError } from '../infra/internal-error';
import { addon, createMicrotaskQueue } from '../js-engine/index';
import { encodingIDLDefinitions } from '../encoding/index';
import { fileIDLDefinitions } from '../file/index';
import { fetchIDLDefinitions } from '../fetch/index';
import { styleletIDLDefinitions } from '../stylelet/index';
import { streamsIDLDefinitions } from '../streams/index';
import { urlIDLDefinitions, originIDL, serializeURL, type Origin, type URLRecord } from '../url/index';
import { xhrIDLDefinitions } from '../xhr/index';
import {
  BindingWorld, createDOMException, type GlobalObjectAllocation,
  type BindingContext, type StampedImplInstance, type StampedPlatformObject,
} from '../web-idl/index';
import { locationIDL } from './browsing/window/location';
import { integrityViolationReportBodyIDL } from './browsing/policy/integrity-policy';
import { coepViolationReportBodyIDL } from './browsing/policy/coep';
import {
  cspViolationReportBodyIDL, securityPolicyViolationEventIDL,
  securityPolicyViolationEventInitIDL, securityPolicyViolationEventDispositionIDL,
} from './browsing/policy/csp/violation';
import { reportIDL, reportBodyIDL } from './reporting/report';
import { testReportBodyIDL } from './reporting/test-report';
import {
  reportingObserverIDL, reportingObserverCallbackIDL, reportingObserverOptionsIDL, reportListIDL,
} from './reporting/observer';
import {
  WindowImpl, windowEventIDL, windowIDL, windowIncludesWindowOrWorkerGlobalScopeIDL,
} from './browsing/window/window';
import { WindowProxyHandle, windowProxyDefinition } from './browsing/window/window-proxy';
import { DocumentImpl, htmlDocumentIDL } from './dom/nodes/document';
import { ElementImpl } from './dom/nodes/element';
import type { NodeImpl } from './dom/nodes/node';
import { domIDLDefinitions } from './dom/web-idl';
import { AbortControllerImpl } from './dom/abort/abort-controller';
import { AbortSignalImpl } from './dom/abort/abort-signal';
import { EventImpl } from './dom/events/event';
import { htmlIDLDefinitions } from './html/web-idl';
import { fileReaderIDL } from './integration/file/file-reader';
import { objectURLIDL } from './integration/file/object-url';
import { requestNodeEventLoopTurn } from './integration/scripting';
import { mathMLIDLDefinitions } from './mathml/web-idl';
import {
  domHighResTimeStampIDL, epochTimeStampIDL, performanceIDL,
} from './performance/performance';
import { unsafeSharedCurrentTime } from './performance/high-resolution-time';
import { SandboxAgent, type WindowAgent } from './scripting/agents';
import type { EventLoopOptions } from './scripting/event-loop';
import {
  createExecution, EnvironmentRecord, SandboxEnvironment, WindowEnvironment,
  type BrowletEnvironment, type BrowletExecution,
} from './scripting/environment';
import type { UserAgent } from './user-agent';
import { eventHandlerIDL, eventHandlerNonNullIDL } from './scripting/event-handlers';
import {
  highResolutionTimeWindowOrWorkerGlobalScopeIDL, timerHandlerIDL,
  windowOrWorkerGlobalScopeIDL, WindowOrWorkerGlobalScopeMixin,
} from './scripting/global-scope';
import { Realm, WindowRealm } from './scripting/realm';
import { structuredSerializeOptionsIDL } from './scripting/structured-data/web-idl';
import { structuredDeserialize } from './scripting/structured-data/deserialize';
import type { SerializedRecord } from './scripting/structured-data/records';
import { structuredSerialize } from './scripting/structured-data/serialize';
import { structuredClone } from './scripting/structured-data/structured-clone';
import { svgIDLDefinitions } from './svg/web-idl';

// The browser environment owns the final Web IDL assembly for its realm.
// Defining specifications contribute declarations and implementation steps;
// Browlet decides which contributions coexist and which initial objects are
// installed on its Window environment. One main binding world spans the realms
// hosted by Browlet's Node VM; it is not owned by an HTML Agent or AgentCluster.

// -- Browser composition ------------------------------------------------

/** Compose a Window, its binding, and the new or reused WindowProxy handle. */
export function createWindowEnvironment(
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
  const envRecord = reservedEnv ?? new EnvironmentRecord({
    userAgent, creationURL, topLevelCreationURL, topLevelOrigin,
    targetBrowsingContext: null,
    isSecureContext: userAgent.isOriginPotentiallyTrustworthy(origin) &&
      (parent === null || parent.isSecureContext),
  });
  const useAddonGlobals = !!(
    addon.getMethod('createContextHandle') && addon.getMethod('runInContext') &&
    addon.getMethod('setPropertyDelegate') && addon.getMethod('setGlobalObject')
  );
  if (useAddonGlobals) previousRealm?.detachGlobal();
  const realm = new WindowRealm({
    agent,
    envRecord,
    reuseGlobalProxyFrom: useAddonGlobals ? previousRealm : undefined,
    // Window.prototype -> named properties -> EventTarget.prototype.
    globalPrototypeChain: useAddonGlobals ? ['immutable', 'delegated', 'immutable'] : undefined,
  });
  // This new realm is registered exactly once; composition runs synchronously.
  let env!: WindowEnvironment;
  const context = registerRealm(realm, (binding) => {
    // https://html.spec.whatwg.org/multipage/nav-history-apis.html#set-up-a-window-environment-settings-object
    // Execution reads the installed global lazily; all consumers retain this environment.
    env = new WindowEnvironment(realm, envRecord, createBoundExecution(binding));
    env.creationURL = creationURL;
    env.topLevelCreationURL = topLevelCreationURL;
    env.topLevelOrigin = topLevelOrigin;
    return env;
  });
  const window = new WindowImpl(new URL(serializeURL(creationURL)), env);
  realm.windowImplementation = window;
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
  realm.windowProxy = WindowProxyHandle.getOrCreate(
    useAddonGlobals ? realm.globalThis : previousRealm?.globalThis,
  );
  realm.setGlobalObjects(globalObject, realm.windowProxy.platform);
  if (reservedEnv !== null) reservedEnv.id = '';
  window.setWindowOrWorkerGlobalScopeMixin(new WindowOrWorkerGlobalScopeMixin(env));
  return env;
}

/** Create browser-owned execution without a Window, Document, or HTML settings object. */
export function createSandboxEnvironment(eventLoopOptions: EventLoopOptions = {
  createMicrotaskQueue,
  requestEventLoopTurn: requestNodeEventLoopTurn,
  unsafeSharedCurrentTime,
}, userAgent?: UserAgent): BrowletEnvironment {
  const realm = new Realm({ agent: new SandboxAgent(eventLoopOptions) });
  // Reuse the main binding world for internal allocations without installing
  // author-facing interfaces on the sandbox's global.
  return registerRealm(realm, (context) => createSandboxEnvironmentFromBinding(context, userAgent)).getEnvironment();
}

/** Construct and stamp a Document in the realm; HTML initialization remains with the caller. */
export function createDocument(realm: Realm): StampedImplInstance<DocumentImpl> {
  return getBindingContext(realm).construct(DocumentImpl);
}

/** Point a proxy at a Window implementation and its existing platform object. */
export function setAssociatedWindow(
  windowProxy: WindowProxyHandle,
  window: WindowImpl,
): void {
  // Window composition has already projected this implementation. Projection
  // retrieves that same platform identity; it does not create another Window.
  const platform = world.project(window);
  if (!platform) throw new InternalError('Window has not been projected');
  windowProxy.setAssociatedWindow({
    implementation: window,
    platform: platform as StampedPlatformObject<Window>,
  });
}

/** Relevant realm of a browser object; Window and DOM-node inputs retain their concrete realm type. */
export function getRelevantRealm(value: Window | WindowImpl | Node | NodeImpl): WindowRealm;
export function getRelevantRealm(value: object): Realm;
export function getRelevantRealm(value: object): Realm {
  const realm = world.getRealm(value) ?? Realm.getAssociatedRealm(value);
  if (!(realm instanceof Realm)) throw new InternalError('Object has no relevant Realm');
  return realm;
}

/** Retrieve an implementation's platform object, allocating its first projection if needed. */
export function project(value: object): StampedPlatformObject {
  const object = world.project(value);
  if (!object) throw new InternalError('Implementation has not been projected');
  return object;
}

/** Retrieve the implementation paired with a platform object in Browlet's binding world. */
export function unwrap<Value extends object>(value: object): StampedImplInstance<Value> {
  const implInst = world.unwrap(value);
  if (!implInst) throw new InternalError('Value is not a platform object');
  return implInst as StampedImplInstance<Value>;
}

/** Register a realm once, composing a sandbox environment unless a factory is supplied. */
export function registerRealm(
  realm: Realm,
  createEnvironment: (context: BindingContext<BrowletEnvironment>) => BrowletEnvironment =
    createSandboxEnvironmentFromBinding,
): BindingContext<BrowletEnvironment> {
  return world.register(realm, createEnvironment);
}

/** Retrieve the realm's context in Browlet's main binding world. */
export function getBindingContext(realm: Realm): BindingContext<BrowletEnvironment> {
  const context = world.getBindingContext(realm);
  if (!context) throw new InternalError('Realm has no Browlet binding');
  return context;
}

// -- Construction helpers -----------------------------------------------

type WindowEnvironmentInit = {
  /** Agent whose event loop executes the new Window's work. */
  agent: WindowAgent;
  /** Browser owner supplying shared state and integration facilities. */
  userAgent: UserAgent;
  /** URL used to initialize the Window's environment. */
  creationURL: URLRecord;
  /** Origin selected for the new Document. */
  origin: Origin;
  /** Parent Window used for ancestry and secure-context determination. */
  parent: WindowImpl | null;
  /** Top-level URL captured for the environment's initial settings. */
  topLevelCreationURL: URLRecord;
  /** Top-level origin captured for partitioning and security decisions. */
  topLevelOrigin: Origin;
  /** Early environment record whose identity survives navigation setup. */
  reservedEnv?: EnvironmentRecord | null;
  /** Previous realm whose WindowProxy identity is reused for navigation. */
  previousRealm?: WindowRealm;
};

/** Assemble a sandbox's environment once its binding context exists. */
function createSandboxEnvironmentFromBinding(
  context: BindingContext<BrowletEnvironment>, userAgent?: UserAgent,
): BrowletEnvironment {
  return new SandboxEnvironment(context.realm, createBoundExecution(context), userAgent);
}

/** Complete realm execution with allocations and structured data owned by this binding. */
export function createBoundExecution(context: BindingContext<BrowletEnvironment>): BrowletExecution {
  const { realm } = context;
  return {
    ...createExecution(realm),
    // Window installation follows binding registration; retain the live global.
    get global() { return realm.global; },
    Promise: context.Promise,
    // Interface binding registration finishes after execution is composed.
    get DOMException() { return context.DOMException; },
    createDOMException,
    createEvent: (EventConstructor = EventImpl) => {
      const event = context.construct(EventConstructor, ['', {}]);
      event.isTrusted = true;
      return event;
    },
    createAbortController: () => context.construct(AbortControllerImpl),
    createDependentAbortSignal: (signals) => AbortSignalImpl.any(
      context.construct(AbortSignalImpl), signals as AbortSignalImpl[],
    ),
    clone: (value, transferList = []) => structuredClone(value, transferList, context),
    // Exception requests become recognizable platform objects at serialization.
    serialize: (value) => structuredSerialize(context.realizeException(value), context),
    deserialize: (record) => structuredDeserialize(record as SerializedRecord, context),
  };
}

/** Project the Window into its realm's global allocation and install provisional additions. */
function projectWindow(
  context: BindingContext<BrowletEnvironment>,
  window: WindowImpl,
  allocation?: GlobalObjectAllocation,
): StampedPlatformObject<Window> {
  const object = context.projectGlobalObject(window, 'Window', allocation) as StampedPlatformObject<Window>;
  // PROVISIONAL: bypasses Web IDL until Stylelet supplies its CSSOM Window
  // partial and CSSStyleDeclaration projection (see style/ROADMAP.md).
  Object.defineProperty(object, 'getComputedStyle', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: (element: unknown, pseudoElement?: string | null) => {
      const implementation = context.unwrap(element, ElementImpl);
      if (!implementation) {
        const { exec } = context.getEnvironment();
        throw new exec.TypeError('getComputedStyle requires an Element.');
      }
      return window.getComputedStyle(implementation, pseudoElement);
    },
  });
  return object;
}

// -- Shared declarations and world --------------------------------------

/** Declarations combined by Browlet's binding world, also available for development validation. */
export const browletDefinitions = [
  htmlDocumentIDL,
  ...htmlIDLDefinitions,
  ...svgIDLDefinitions,
  ...mathMLIDLDefinitions,
  originIDL,
  locationIDL,
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
  windowProxyDefinition,
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

/** Shared implementation/platform identity across Browlet's registered realms. */
const world = new BindingWorld<BrowletEnvironment>(browletDefinitions);
