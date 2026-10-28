import { EOL } from 'node:os';

import { InternalError } from '../infra/index';
import { addon } from '../js-engine/index';
import {
  BindingWorld, QuotaExceededErrorImpl, type GlobalObjectAllocation,
  type BindingContext, type ImplementationClass, type StampedPlatformObject,
} from '../web-idl/index';
import { streamsIDLDefinitions } from '../streams/index';
import { encodingIDLDefinitions } from '../encoding/index';
import { urlIDLDefinitions, serializeURL } from '../url/index';
import { fileIDLDefinitions } from '../file/index';
import { xhrIDLDefinitions } from '../xhr/index';
import { fetchIDLDefinitions } from '../fetch/index';
import { CSSStyleSheetImpl, styleletIDLDefinitions } from '../stylelet/index';

import type { CSSStyleSheet, QuotaExceededError, Window } from './platform';
import { domHighResTimeStampIDL, epochTimeStampIDL } from './timing/index';
import {
  EventLoop, SandboxAgent, eventHandlerIDL, eventHandlerNonNullIDL,
  BrowletRealm, WindowRealm, installRealmHostHooks,
} from './scripting/index';
import {
  EventImpl, errorEventIDL, errorEventInitIDL, promiseRejectionEventIDL, promiseRejectionEventInitIDL,
} from './dom/events/index';
import {
  reportIDL, reportBodyIDL, testReportBodyIDL, reportingObserverIDL, reportingObserverCallbackIDL,
  reportingObserverOptionsIDL, reportListIDL,
} from './reporting/index';
import {
  integrityViolationReportBodyIDL, coepViolationReportBodyIDL, coepInheritanceViolationReportBodyIDL,
} from './browsing/policy/index';
import {
  cspViolationReportBodyIDL, securityPolicyViolationEventIDL, securityPolicyViolationEventInitIDL,
  securityPolicyViolationEventDispositionIDL,
} from './browsing/policy/csp/index';
import { trustedTypesIDLDefinitions } from './browsing/policy/trusted-types/index';
import { AbortControllerImpl, AbortSignalImpl } from './dom/abort/index';
import {
  DocumentImpl, htmlDocumentIDL, documentReadyStateIDL, documentVisibilityStateIDL,
  htmlOrSVGScriptElementIDL, htmlDocumentOrShadowRootIDL, htmlAllCollectionIDL,
} from './dom/nodes/index';
import { htmlIDLDefinitions } from './dom/nodes/html/index';
import { mathMLIDLDefinitions } from './dom/nodes/mathml/index';
import { svgIDLDefinitions } from './dom/nodes/svg/index';
import { domIDLDefinitions } from './dom/index';
import { performanceIDL } from './performance/index';
import {
  locationIDL, WindowImpl, windowEventIDL, windowIDL, windowIncludesWindowOrWorkerGlobalScopeIDL,
  WindowProxyHandle, windowProxyDefinition,
} from './browsing/window/index';
import { messageEventIDL } from './communication/index';
import { originIDL } from './browsing/index';
import {
  type WindowEnvironmentInit, BrowletEnvironmentBase, SandboxEnvironment, WindowEnvironment, type BrowletEnvironment,
  type BrowletEnvironmentInit,
} from './environment';
import {
  WindowOrWorkerGlobalScopeMixin, highResolutionTimeWindowOrWorkerGlobalScopeIDL,
  timerHandlerIDL, windowOrWorkerGlobalScopeIDL, trustedTypesWindowOrWorkerGlobalScopeIDL,
} from './global-scope';
import {
  structuredSerializeOptionsIDL, structuredDeserialize, type SerializedRecord, structuredSerialize,
  structuredClone,
} from './scripting/structured-data/index';
import { progressEventIDL, progressEventInitIDL } from './integration/xhr/index';
import { htmlExtendedAttributeHooks } from './integration/web-idl/index';
import { fileReaderIDL, objectURLIDL } from './integration/file/index';
import { queueNodeTask } from './integration/index';
import type { UserAgent } from './user-agent';

// Browlet's composition root owns the final Web IDL assembly.
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
  // SPEC_CLASH(secure-context-top-level-url): HTML checks the top-level creation URL; retain origin-and-ancestry checks.
  // Approved for Window creation: preserve the selected origin and parent's full
  // security chain. A reserved environment already carries that fixed decision.
  // See browsing/policy/ROADMAP.md#trustworthiness for the differing results.
  // https://html.spec.whatwg.org/multipage/webappapis.html#secure-context
  // https://w3c.github.io/webappsec-secure-contexts/#ancestors
  const baseEnv = reservedEnv ?? new BrowletEnvironmentBase({
    userAgent, creationURL, topLevelCreationURL, topLevelOrigin,
    targetBrowsingContext: null,
    isSecureContext: userAgent.isOriginPotentiallyTrustworthy(origin) &&
      (parent === null || parent.isSecureContext),
  });
  const useAddonGlobals = !!(
    addon.createContextHandle && addon.runInContext &&
    addon.setPropertyDelegate && addon.setGlobalObject
  );
  if (useAddonGlobals) previousRealm?.detachGlobal();
  const realm = new WindowRealm({
    agent,
    baseEnv,
    reuseGlobalProxyFrom: useAddonGlobals ? previousRealm : undefined,
    // Window.prototype -> named properties -> EventTarget.prototype.
    globalPrototypeChain: useAddonGlobals ? ['immutable', 'delegated', 'immutable'] : undefined,
  });
  // This new realm is registered exactly once; composition runs synchronously.
  let env!: WindowEnvironment;
  realm.initialize({
    createGlobalObject: () => {
      const context = browletBindingWorld.register(realm, (binding) => {
        // https://html.spec.whatwg.org/multipage/nav-history-apis.html#set-up-a-window-environment-settings-object
        // All consumers retain this environment; its realm supplies the installed global.
        env = new WindowEnvironment(realm, baseEnv, createBrowletEnvironmentInit(binding));
        env.creationURL = creationURL;
        env.topLevelCreationURL = topLevelCreationURL;
        env.topLevelOrigin = topLevelOrigin;
        return env;
      });
      const window = new WindowImpl(new URL(serializeURL(creationURL)), env);
      realm.windowImplementation = window;
      if (!useAddonGlobals) return projectWindow(context, window);

      const { object, prototypeChain } = realm.globalAllocation;
      const [windowPrototype, namedProperties, eventTargetPrototype] = prototypeChain;
      if (!windowPrototype || !namedProperties || !eventTargetPrototype) {
        throw new InternalError('Incomplete native Window allocation');
      }
      // With add-on globals, supply the engine-allocated global object and prototypes to Web IDL.
      return projectWindow(context, window, {
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
    },
    createGlobalThisValue: () => {
      realm.windowProxy = previousRealm?.windowProxy ?? new WindowProxyHandle(
        useAddonGlobals ? realm.globalProxy : undefined,
      );
      return realm.windowProxy.platform;
    },
  });
  if (reservedEnv !== null) reservedEnv.id = '';
  realm.windowImplementation.setWindowOrWorkerGlobalScopeMixin(new WindowOrWorkerGlobalScopeMixin(env));
  installRealmHostHooks(env);
  return env;
}

/** Create browser-owned facilities without a Window, Document, or HTML settings object. */
export function createSandboxEnvironment(userAgent?: UserAgent): BrowletEnvironment {
  const agent = new SandboxAgent(new EventLoop({ requestTurn: queueNodeTask }));
  const realm = new BrowletRealm({ agent });
  // Reuse the main binding world for internal allocations without installing
  // author-facing interfaces on the sandbox's global.
  return browletBindingWorld.register(realm, (context) =>
    new SandboxEnvironment(realm, createBrowletEnvironmentInit(context), userAgent),
  ).getEnvironment();
}

// -- Construction helpers -----------------------------------------------

/** Supply the binding-owned functions consumed during environment construction. */
export function createBrowletEnvironmentInit(context: BindingContext<BrowletEnvironment>): BrowletEnvironmentInit {
  return {
    nativeLineEnding: EOL as '\n' | '\r\n',
    runInParallel: queueNodeTask,
    InternalPromise: context.InternalPromise,
    // Interface binding registration finishes after the environment is composed.
    getDOMException: () => context.DOMException,
    constructNode<T extends object>(implementation: ImplementationClass<T>, argumentsList: unknown[]): T {
      return context.construct(implementation, argumentsList);
    },
    createDocument: () => context.construct(DocumentImpl),
    createEvent: (EventConstructor = EventImpl) => {
      const event = context.construct(EventConstructor, ['', {}]);
      event.isTrusted = true;
      return event;
    },
    createAbortSignal: () => context.construct(AbortSignalImpl),
    createQuotaExceededError: () =>
      context.project(QuotaExceededErrorImpl, new QuotaExceededErrorImpl()) as StampedPlatformObject<QuotaExceededError>,
    projectCSSStyleSheet: (sheet) => context.project(CSSStyleSheetImpl, sheet) as StampedPlatformObject<CSSStyleSheet>,
    createAbortController: () => context.construct(AbortControllerImpl),
    createDependentAbortSignal: (signals) => AbortSignalImpl.any(
      context.construct(AbortSignalImpl), signals as AbortSignalImpl[],
    ),
    clone: (value, transferList = []) => structuredClone(value, transferList, context),
    // Associate DOMException implementations before structured serialization.
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
  return context.projectGlobalObject(window, 'Window', allocation) as StampedPlatformObject<Window>;
}

// -- Shared declarations and world --------------------------------------

/** Declarations combined by Browlet's binding world, also available for development validation. */
export const browletDefinitions = [
  documentReadyStateIDL,
  documentVisibilityStateIDL,
  htmlOrSVGScriptElementIDL,
  htmlDocumentIDL,
  htmlDocumentOrShadowRootIDL,
  htmlAllCollectionIDL,
  ...htmlIDLDefinitions,
  ...svgIDLDefinitions,
  ...mathMLIDLDefinitions,
  originIDL,
  locationIDL,
  reportIDL, reportBodyIDL, integrityViolationReportBodyIDL, testReportBodyIDL,
  coepViolationReportBodyIDL, coepInheritanceViolationReportBodyIDL,
  cspViolationReportBodyIDL,
  securityPolicyViolationEventIDL, securityPolicyViolationEventInitIDL, securityPolicyViolationEventDispositionIDL,
  reportingObserverIDL, reportingObserverCallbackIDL, reportingObserverOptionsIDL, reportListIDL,
  domHighResTimeStampIDL,
  epochTimeStampIDL,
  performanceIDL,
  eventHandlerNonNullIDL,
  eventHandlerIDL,
  errorEventIDL,
  errorEventInitIDL,
  messageEventIDL,
  promiseRejectionEventIDL,
  promiseRejectionEventInitIDL,
  structuredSerializeOptionsIDL,
  timerHandlerIDL,
  windowOrWorkerGlobalScopeIDL,
  highResolutionTimeWindowOrWorkerGlobalScopeIDL,
  trustedTypesWindowOrWorkerGlobalScopeIDL,
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
  progressEventIDL,
  progressEventInitIDL,
  ...urlIDLDefinitions,
  ...fetchIDLDefinitions,
  ...trustedTypesIDLDefinitions,
];

/** Main world for composition and host API projection; implementations use their supplied environment. */
export const browletBindingWorld = new BindingWorld<BrowletEnvironment>(browletDefinitions, {
  extendedAttributes: htmlExtendedAttributeHooks,
});
