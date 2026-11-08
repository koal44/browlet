import { EOL } from 'node:os';

import { InternalError } from '../../../infra/index';
import { isObject, JSThread } from '../../../js-engine/index';
import {
  PlatformRecordSource, BindingWorld, QuotaExceededErrorImpl, reference, type BindingContext, type ImplementationClass,
  type StampedPlatformObject, type RealmBinding,
} from '../../../web-idl/index';
import { copyOrigin, copyURL, createOpaqueOrigin } from '../../../url/index';
import { type PermissionDescriptor } from '../../../permissions/index';
import { StorageKey } from '../../../storage/index';

import { EventImpl } from '../../dom/events/index';
import { EventLoop, SandboxAgent, SharedWorkerAgent, BrowletRealm, WindowRealm, installRealmHostHooks } from '../../scripting/index';
import { TrustedScriptImpl } from '../../browsing/policy/trusted-types/index';
import { AbortControllerImpl, AbortSignalImpl } from '../../dom/abort/index';
import { DocumentImpl, ElementImpl } from '../../dom/nodes/index';
import { DOMStringListImpl, type EventImplConstructor } from '../../dom/index';
import { MessagePortImpl } from '../../communication/index';
import { WindowImpl, WindowProxyHandle } from '../../browsing/window/index';
import {
  type WindowEnvironmentInit, BrowletEnvironmentBase, SandboxEnvironment, WindowEnvironment,
  type BrowletEnvironment, type BrowletEnvironmentInit, WindowOrWorkerGlobalScopeMixin,
  WorkerEnvironment, type WorkerEnvironmentInit, type WorkerEnvironmentSnapshotInit, type WorkerSettings,
} from '../../environment/index';
import {
  structuredDeserialize, type SerializedRecord, structuredSerialize, structuredSerializeForStorage, structuredClone,
  structuredSerializeWithTransfer, structuredDeserializeWithTransfer,
} from '../../scripting/structured-data/index';
import { DedicatedWorkerGlobalImpl, SharedWorkerGlobalImpl, WorkerGlobalImpl, type WorkerOwner } from '../../workers/index';
import { queueNodeTask } from '../host/index';
import { PermissionStatusImpl } from '../permissions/index';
import { WorkerThreadRuntime } from '../workers/index';
import { htmlExtendedAttributeHooks, getWindowProxyAccess, installWasmIntrinsics, installWasmExceptionBinding } from './bindings/index';
import type { QuotaExceededError } from '../../platform';
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
  // An existing reservation carries the fixed security decision; without one,
  // share the incoming-Window calculation used before agent selection.
  const baseEnv = reservedEnv ?? new BrowletEnvironmentBase({
    userAgent, creationURL, topLevelCreationURL, topLevelOrigin,
    targetBrowsingContext: null,
    isSecureContext: userAgent.computeWindowSecureContext(origin, parent?.env),
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
      // This world registers only Browlet environments; its internal lookup erases that type.
      installWasmExceptionBinding(browletBindingWorld.getRealmBinding(realm)! as RealmBinding<BrowletEnvironment>);
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
  installWasmIntrinsics(context);
  return env;
}

/** Compose a worker's realm, global, and settings on its caller-supplied agent. */
// https://html.spec.whatwg.org/multipage/workers.html#run-a-worker
// https://html.spec.whatwg.org/multipage/workers.html#set-up-a-worker-environment-settings-object
// This is only the setup portion. The processing-model caller must supply independent
// execution, fetch/initialize the response policies, and mark execution readiness.
export function createWorkerEnvironment(initialization: WorkerEnvironmentInit): WorkerEnvironment {
  const { outsideEnv, url, unsafeWorkerCreationTime } = initialization;
  const owner = WorkerGlobalImpl.getRelevantOwner(outsideEnv);
  const isData = url.scheme === 'data';
  const baseEnv = new BrowletEnvironmentBase({
    userAgent: outsideEnv.userAgent, creationURL: url, topLevelCreationURL: null,
    // HTML leaves shared workers' top-level origin implementation-defined. Capture
    // the first creator's partition, as dedicated workers do; do not change it on reconnect.
    topLevelOrigin: outsideEnv.topLevelOrigin, targetBrowsingContext: null,
    isSecureContext: outsideEnv.isSecureContext,
  });
  const settings = {
    origin: isData ? createOpaqueOrigin() : outsideEnv.origin,
    hasCrossSiteAncestor: outsideEnv.hasCrossSiteAncestor || isData,
    unsafeWorkerCreationTime,
  };
  return createWorkerRealm(initialization, baseEnv, settings, owner, StorageKey.obtainForNonStoragePurposes(outsideEnv));
}

/** Compose the real inside realm from transported creator values and local host facilities. */
// https://html.spec.whatwg.org/multipage/workers.html#set-up-a-worker-environment-settings-object
// This does not manufacture a creator Window or a second UserAgent. Shared
// services and the original owner's lifetime remain explicit startup dependencies.
export function createWorkerEnvironmentFromSnapshot(initialization: WorkerEnvironmentSnapshotInit): WorkerEnvironment {
  const { creatorEnvSnapshot: creator, environmentId, unsafeWorkerCreationTime } = initialization;
  const url = copyURL(initialization.url);
  const isData = url.scheme === 'data';
  const baseEnv = new BrowletEnvironmentBase({
    id: environmentId, userAgent: initialization.userAgent, creationURL: url, topLevelCreationURL: null,
    topLevelOrigin: creator.topLevelOrigin === null ? null : copyOrigin(creator.topLevelOrigin),
    targetBrowsingContext: null, isSecureContext: creator.isSecureContext,
  });
  return createWorkerRealm({ ...initialization, url }, baseEnv, {
    origin: copyOrigin(initialization.origin),
    hasCrossSiteAncestor: creator.hasCrossSiteAncestor || isData, unsafeWorkerCreationTime,
  }, null, new StorageKey(copyOrigin(creator.origin)));
}

/** Share realm/global projection between local creation and the transported inside environment. */
function createWorkerRealm(
  initialization: Omit<WorkerEnvironmentInit, 'outsideEnv'>, baseEnv: BrowletEnvironmentBase, settings: WorkerSettings,
  owner: WorkerOwner | null, constructorStorageKey: StorageKey,
): WorkerEnvironment {
  const { agent, url, type, name, credentials, extendedLifetime } = initialization;
  const isShared = agent instanceof SharedWorkerAgent;
  const globalName = isShared ? 'SharedWorker' : 'DedicatedWorker';
  let env!: WorkerEnvironment;
  let context!: BindingContext<BrowletEnvironment>;
  const realm = new BrowletRealm({ agent, baseEnv, globalNames: ['Worker', globalName] });
  realm.initialize({
    createGlobalObject: () => {
      context = browletBindingWorld.register(realm, (binding) => {
        env = new WorkerEnvironment(realm, baseEnv, createBrowletEnvironmentInit(binding), settings);
        return env;
      });
      let global: DedicatedWorkerGlobalImpl | SharedWorkerGlobalImpl;
      if (agent instanceof SharedWorkerAgent) {
        global = new SharedWorkerGlobalImpl(type, name, constructorStorageKey,
          url, credentials, extendedLifetime, env);
        agent.globalScope = global;
      } else {
        global = new DedicatedWorkerGlobalImpl(type, name, env);
        agent.globalScope = global;
      }
      // SPEC_GAP(worker-setup-url): Settings read the global URL before run-a-worker
      // assigns the response URL. Use the request URL provisionally; Blink likewise
      // computes initial settings from its separate script_url creation parameter.
      // The Fetch hook must replace both global.url and env.creationURL on success.
      global.url = url;
      // TODO(HTML §10.2.4): Transport owner activity before running lifetime
      // checks for a remote creator. Its Document/global remains in its isolate.
      if (owner !== null) global.ownerSet.add(owner);
      env.globalImplementation = global;
      installWasmExceptionBinding(browletBindingWorld.getRealmBinding(realm)! as RealmBinding<BrowletEnvironment>);
      return context.projectGlobalObject(global, `${globalName}GlobalScope`);
    },
  });
  installRealmHostHooks(env, getCodeForEval);
  installWasmIntrinsics(context);
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
  function createEvent<T extends EventImpl>(eventConstructor: EventImplConstructor<T>): T;
  function createEvent(eventConstructor?: EventImplConstructor): EventImpl;
  function createEvent(EventConstructor: EventImplConstructor = EventImpl): EventImpl {
    const event = context.construct<EventImpl>(EventConstructor, ['', {}]);
    event.isTrusted = true;
    return event;
  }

  return {
    project: (implInst) => context.project(implInst.constructor, implInst),
    unwrap: (platformObject) => context.unwrap(platformObject),
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
    createEvent,
    createAbortSignal: () => context.construct(AbortSignalImpl),
    createQuotaExceededError: () =>
      context.project(QuotaExceededErrorImpl, new QuotaExceededErrorImpl()) as StampedPlatformObject<QuotaExceededError>,
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

// Browlet's composition root owns the fixed bundle entry and supplies Binding
// to the lower host transport. JS Engine handles the private startup marker and
// waits for module evaluation; ordinary imports do not create a worker.
JSThread.initialize(import.meta.url, () => {
  const runtime = new WorkerThreadRuntime(createWorkerEnvironmentFromSnapshot);
  runtime.run();
});
