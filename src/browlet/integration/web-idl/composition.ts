import { EOL } from 'node:os';

import { InternalError } from '../../../infra/index';
import { isObject } from '../../../js-engine/index';
import {
  PlatformRecordSource, BindingWorld, QuotaExceededErrorImpl, reference, type BindingContext, type ImplementationClass,
  type StampedPlatformObject,
} from '../../../web-idl/index';
import { type PermissionDescriptor } from '../../../permissions/index';
import { CSSStyleSheetImpl } from '../../../stylelet/index';

import { EventImpl } from '../../dom/events/index';
import { EventLoop, SandboxAgent, BrowletRealm, WindowRealm, installRealmHostHooks } from '../../scripting/index';
import { TrustedScriptImpl } from '../../browsing/policy/trusted-types/index';
import { AbortControllerImpl, AbortSignalImpl } from '../../dom/abort/index';
import { DocumentImpl, ElementImpl } from '../../dom/nodes/index';
import { DOMStringListImpl } from '../../dom/index';
import { MessagePortImpl } from '../../communication/index';
import { WindowImpl, WindowProxyHandle } from '../../browsing/window/index';
import {
  type WindowEnvironmentInit, BrowletEnvironmentBase, SandboxEnvironment, WindowEnvironment,
  type BrowletEnvironment, type BrowletEnvironmentInit, WindowOrWorkerGlobalScopeMixin,
} from '../../environment/index';
import {
  structuredDeserialize, type SerializedRecord, structuredSerialize, structuredSerializeForStorage, structuredClone,
  structuredSerializeWithTransfer, structuredDeserializeWithTransfer,
} from '../../scripting/structured-data/index';
import { queueNodeTask } from '../host/index';
import { PermissionStatusImpl } from '../permissions/index';
import { htmlExtendedAttributeHooks, getWindowProxyAccess } from './bindings/index';
import type { CSSStyleSheet, QuotaExceededError } from '../../platform';
import type { UserAgent } from '../../user-agent';

import { browletDefinitions } from './web-idl';

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
  // See ../../browsing/policy/ROADMAP.md#trustworthiness for the differing results.
  // https://html.spec.whatwg.org/multipage/webappapis.html#secure-context
  // https://w3c.github.io/webappsec-secure-contexts/#ancestors
  const baseEnv = reservedEnv ?? new BrowletEnvironmentBase({
    userAgent, creationURL, topLevelCreationURL, topLevelOrigin,
    targetBrowsingContext: null,
    isSecureContext: userAgent.isOriginPotentiallyTrustworthy(origin) &&
      (parent === null || parent.isSecureContext),
  });
  // This new realm is registered exactly once; composition runs synchronously.
  let env!: WindowEnvironment;
  let context!: BindingContext<BrowletEnvironment>;
  const realm: WindowRealm = new WindowRealm({
    agent,
    baseEnv,
    reuseGlobalProxyFrom: previousRealm,
    // Window.prototype -> named properties -> EventTarget.prototype.
    globalPrototypeChain: ['immutable', 'delegated', 'immutable'],
    globalAccess: (callerRealm) => getWindowProxyAccess(context, realm.windowProxy, callerRealm),
  });
  realm.initialize({
    createGlobalObject: () => {
      context = browletBindingWorld.register(realm, (binding) => {
        // https://html.spec.whatwg.org/multipage/nav-history-apis.html#set-up-a-window-environment-settings-object
        // All consumers retain this environment; its realm supplies the installed global.
        env = new WindowEnvironment(realm, baseEnv, {
          ...createBrowletEnvironmentInit(binding),
          // HTML current-value steps 3.9–3.12: compile in this Window's realm,
          // then create the callback with this environment as callback context.
          createEventHandler(name, body, filename, element, form) {
            const specialErrorHandler = element === null && name === 'onerror';
            const parameters = specialErrorHandler ? ['event', 'source', 'lineno', 'colno', 'error'] : ['event'];
            // Outermost first: global, Document, form owner, then the element.
            // Binding preserves each object's platform identity, including after adoption.
            const contextExtensions: object[] = [];
            if (element !== null) contextExtensions.push(binding.project(DocumentImpl, element.nodeDocument)!);
            if (form !== null) contextExtensions.push(binding.project(ElementImpl, form)!);
            if (element !== null) contextExtensions.push(binding.project(ElementImpl, element)!);
            const callback = this.realm.compileFunction(body, parameters, { name, filename, contextExtensions });
            const callbackType = specialErrorHandler ? 'OnErrorEventHandlerNonNull'
              : name === 'onbeforeunload' ? 'OnBeforeUnloadEventHandlerNonNull' : 'EventHandlerNonNull';
            return binding.createCallbackFunction(callback, reference(callbackType), this);
          },
        });
        env.creationURL = creationURL;
        env.topLevelCreationURL = topLevelCreationURL;
        env.topLevelOrigin = topLevelOrigin;
        return env;
      });
      const window = new WindowImpl(env);
      realm.windowImplementation = window;
      const allocation = realm.globalAllocation;
      if (!allocation) return context.projectGlobalObject(window, 'Window');

      const { object, prototypeChain } = allocation;
      const [windowPrototype, namedProperties, eventTargetPrototype] = prototypeChain;
      if (!windowPrototype || !namedProperties || !eventTargetPrototype) {
        throw new InternalError('Incomplete Window global allocation');
      }
      // Supply the engine-allocated global object and prototypes to Web IDL.
      return context.projectGlobalObject(window, 'Window', {
        object,
        registerAttributeGetter: (getter) => realm.registerGlobalGetter(getter),
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
        realm.globalAllocation ? realm.globalProxy : undefined,
      );
      return realm.windowProxy.platform;
    },
  });
  if (realm.globalAllocation) {
    // Native callbacks select their original context. Keep child lookup bound
    // to that Window, independently of the handle's movable target.
    const window = realm.windowImplementation;
    realm.setGlobalIndexedProperties({
      getOwnPropertyDescriptor: (index) => WindowProxyHandle.getIndexedOwnProperty(window, index),
      // HTML §§7.2.3.6, 7.2.3.8–9: indices reject writes; deletion succeeds only without a child.
      // SPEC_CLASH(window-indexed-reflect-result): follow HTML/Firefox/WebKit's false; Chromium reports success without writing.
      // TODO(HTML 7.2.3.8): Run the same-origin COOP access check before indexed assignment.
      set: () => false,
      defineProperty: () => false,
      deleteProperty: (index) => window.getIndexedWindow(index) === undefined,
      ownKeys: () => Array.from({ length: window.length }, (_, index) => index),
    });
  }
  if (reservedEnv !== null) reservedEnv.id = '';
  realm.windowImplementation.setWindowOrWorkerGlobalScopeMixin(new WindowOrWorkerGlobalScopeMixin(env));
  installRealmHostHooks(env, getCodeForEval);
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

/** Recognize a TrustedScript platform object and read its retained implementation data. */
// https://html.spec.whatwg.org/multipage/webappapis.html#hostgetcodeforeval
// SPEC_MISMATCH: HostGetCodeForEval(argument) -> a String or no-code
// undefined represents no-code for the native extraction callback.
function getCodeForEval(argument: unknown): string | undefined {
  if (!isObject(argument)) return undefined;
  const script = browletBindingWorld.unwrap(argument);
  return TrustedScriptImpl.is(script) ? script.data : undefined;
}

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
    createDOMStringList: (strings) => context.construct(DOMStringListImpl, [strings]),
    createEvent: (EventConstructor = EventImpl) => {
      const event = context.construct<EventImpl>(EventConstructor, ['', {}]);
      event.isTrusted = true;
      return event;
    },
    createAbortSignal: () => context.construct(AbortSignalImpl),
    createQuotaExceededError: () =>
      context.project(QuotaExceededErrorImpl, new QuotaExceededErrorImpl()) as StampedPlatformObject<QuotaExceededError>,
    projectCSSStyleSheet: (sheet) => context.project(CSSStyleSheetImpl, sheet) as StampedPlatformObject<CSSStyleSheet>,
    convertPermissionDescriptor: (value, type) => context.jsToImpl(value, reference(type)) as PermissionDescriptor,
    // https://w3c.github.io/permissions/#creating-instances
    createPermissionStatus: (descriptor) => {
      const feature = context.getEnvironment().userAgent.permissionStore.getFeature(descriptor.name);
      if (!feature) throw new InternalError('PermissionStatus requires a supported feature');
      const status = context.createPlatformRecord(feature.resultType)?.implInst;
      if (!(status instanceof PermissionStatusImpl)) {
        throw new InternalError(`Permission result type must extend PermissionStatus: ${feature.resultType}`);
      }
      status.query = descriptor;
      status.name = descriptor.name;
      status.env.userAgent.permissionStatuses.add(new WeakRef(status));
      return status;
    },
    createAbortController: () => context.construct(AbortControllerImpl),
    createDependentAbortSignal: (signals) => AbortSignalImpl.any(
      context.construct(AbortSignalImpl), signals as AbortSignalImpl[],
    ),
    clone: (value, transferList = []) => structuredClone(value, transferList, context),
    // Associate DOMException implementations before structured serialization.
    serialize: (value) => structuredSerialize(context.realizeException(value), context),
    serializeForStorage: (value) => structuredSerializeForStorage(context.realizeException(value), context),
    deserialize: (record) => structuredDeserialize(record as SerializedRecord, context),
    serializeWithTransfer: (value, transfer) => structuredSerializeWithTransfer(value, transfer, context),
    deserializeWithTransfer: (record) => {
      const result = structuredDeserializeWithTransfer(record, context);
      // Keep the message graph projected; internal delivery consumes implementation ports.
      result.transferredValues = result.transferredValues.map((value) =>
        context.getPlatformRecord(value, PlatformRecordSource.Platform)?.implInst ?? value);
      return result;
    },
    getMessagePorts: (transfer) => {
      const ports: MessagePortImpl[] = [];
      for (const value of transfer) {
        const port = context.unwrap(value, MessagePortImpl);
        if (port) ports.push(port);
      }
      return ports;
    },
  };
}

/** Main world for composition and host API projection; implementations use their supplied environment. */
export const browletBindingWorld = new BindingWorld<BrowletEnvironment>(browletDefinitions, {
  extendedAttributes: htmlExtendedAttributeHooks,
  getIncumbentEnvironment(methodEnv) {
    const loop = methodEnv.responsibleEventLoop;
    if (loop.executionContextStack.length === 0 && loop.backupIncumbentEnvironmentStack.length === 0) return undefined;
    return loop.getIncumbentEnvironment();
  },
});
