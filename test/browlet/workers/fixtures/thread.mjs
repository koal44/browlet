/* global process, console */

import { threadId, isMainThread, workerData } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { WorkerThread, WorkerThreadRuntime } from '../../../../src/browlet/integration/workers/index.ts';
import {
  AgentCluster, ClassicScript, EventLoop, JavaScriptModuleScript, ScriptFetchOptions,
  SharedWorkerAgent, WindowAgent, createTaskSource, networkingTaskSource,
} from '../../../../src/browlet/scripting/index.ts';
import { addon, JSThread } from '../../../../src/js-engine/index.ts';
import { WorkerImpl } from '../../../../src/browlet/workers/index.ts';
import { createWindowEnvironment, createWorkerEnvironment, createWorkerEnvironmentFromSnapshot } from '../../../../src/browlet/integration/web-idl/index.ts';
import { UserAgent } from '../../../../src/browlet/user-agent.ts';
import { parseURL, serializeURL } from '../../../../src/url/index.ts';
import { FetchResponse } from '../../../../src/fetch/index.ts';

const filename = fileURLToPath(import.meta.url);
// JS Engine's envelope contains the original browser startup inputs.
const initialization = workerData.data;
const { mode, state, traceTiming } = initialization.data ?? { mode: 'run-startup' };
traceWorker('fixture module evaluated');
if (mode === 'throw-before-ready') throw new Error('bootstrap failed');
if (mode === 'exit-before-ready') process.exit(0);
if (mode === 'wait-before-ready') {
  Atomics.store(state, 0, 1);
  Atomics.wait(state, 1, 0);
}

// Suite setup compiles this entry once. Each real isolate evaluates fresh runtime
// modules without TypeScript transforms or cache writes that termination could interrupt.

// Descendants reload this fixture too. This replaces only the entry registration,
// without mocking the transport, runtime, agent allocation, or environment capture.
JSThread.initialize(pathToFileURL(filename).href, startFixture);

function startFixture() {
  traceWorker('runtime setup starts');
  const runtime = new WorkerThreadRuntime(createWorkerEnvironmentFromSnapshot);
  if (mode === 'run-startup') {
    runtime.run();
    return;
  }
  if (mode === 'load-startup') {
    const { serializeURL } = loadTypeScript('../../../../src/url/index.ts', __filename);
    // Observe the production loading stage without advancing readiness or
    // replacing its module-map, Fetch, or engine linking algorithms.
    runtime.start(() => runtime.fetchScript(), (result) => runtime.loadScript(result, (script) => {
      const env = runtime.environment;
      runtime.send({
        status: script === null ? 'fetch-failure' : script.errorToRethrow === null ? 'linked' : 'script-error',
        url: env.global.location.href,
        baseURL: script?.baseURL === undefined || script.baseURL === null ? null : serializeURL(script.baseURL),
        scriptRan: Reflect.has(env.global, 'moduleRan'),
        executionReady: env.executionReady,
        modules: env.moduleMap.entries.map(({ key, value }) => ({
          url: serializeURL(key[0]),
          type: key[1],
          status: value?.record?.code.status ?? null,
          sameEnvironment: value?.env === env,
        })),
      });
    }));
    return;
  }

  const realm = runtime.environment.realm;
  const followupTaskSource = createTaskSource('worker fixture continuation');
  let messagingEnv;
  let capturedModuleURL;
  runtime.start((message) => {
    switch (message.type) {
      case 'prepare-worker-messages':
        messagingEnv = prepareWorkerMessages(runtime, message.portTransfers);
        runtime.send('prepared');
        break;
      case 'start-worker-messages':
        messagingEnv.globalImplementation.insidePort.start();
        runtime.send(messagingEnv.global.messageCount);
        break;
      case 'inspect-worker-messages':
        runtime.send(messagingEnv.global.messageCount);
        break;
      case 'send-worker-messages':
        for (const value of message.values) messagingEnv.global.postMessage(value);
        runtime.send('sent');
        break;
      case 'close-worker-messages':
        closeWorkerMessages(messagingEnv);
        break;
      case 'close-configured-worker':
        closeConfiguredWorker(runtime, message.blobURL);
        break;
      case 'inspect':
        runtime.send({
          threadId, isMainThread, pid: process.pid,
          kind: runtime.agent instanceof SharedWorkerAgent ? 'shared' : 'dedicated',
          canBlock: runtime.agent.canBlock,
          hasEnvironment: realm.hasEnvironment,
          cluster: runtime.agent.agentCluster === null ? null : {
            id: runtime.agent.agentCluster.id,
            crossOriginIsolationMode: runtime.agent.agentCluster.crossOriginIsolationMode,
            isOriginKeyed: runtime.agent.agentCluster.isOriginKeyed,
            localMembers: runtime.agent.agentCluster.agents.size,
          },
          ownsTask: runtime.agent.eventLoop.currentlyRunningTask !== null,
          separateRealm: realm.arrayPrototype !== Array.prototype,
          addon: typeof addon.createContextHandle === 'function',
          nodeBase: process.env.NODE_BASE,
          data: runtime.data,
          creatorEnvSnapshot: runtime.creatorEnvSnapshot,
        });
        break;
      case 'inspect-lifetime': {
        const global = runtime.environment.globalImplementation;
        runtime.send({
          activelyNeeded: global.isActivelyNeeded(),
          permissible: global.isPermissible(),
          suspendable: global.isSuspendable(),
        });
        break;
      }
      case 'monitor-lifetime':
        try {
          runtime.monitorLifetime(() => {
            if (message.state) runSuspendableScript(runtime, message);
            else runtime.send('monitoring');
          });
        } catch (error) { runtime.send({ errorMessage: error.message }); }
        break;
      case 'run-suspendable-script':
        runSuspendableScript(runtime, message);
        break;
      case 'start-timers':
        startTimers(runtime, message);
        runtime.send('scheduled');
        break;
      case 'inspect-timers':
        runtime.send({
          calls: realm.globalObject.timerCalls,
          outstanding: runtime.environment.getWindowOrWorkerGlobalScopeMixin().timers.hasOutstandingTimers(),
          ownsTimerTask: realm.globalObject.ownsTimerTask,
          elapsed: realm.globalObject.timerElapsed,
        });
        break;
      case 'cancel-timer':
        runtime.environment.global.clearTimeout(realm.globalObject.workerTimerId);
        runtime.send('canceled');
        break;
      case 'inspect-environment': {
        const env = runtime.environment;
        const { serializeURL } = loadTypeScript('../../../../src/url/index.ts', __filename);
        let sharedServicesError;
        try { void env.userAgent; } catch (error) { sharedServicesError = error.message; }
        const global = env.globalImplementation;
        runtime.send({
          id: env.id, origin: env.origin, topLevelOrigin: env.topLevelOrigin,
          creationURL: serializeURL(env.creationURL), topLevelCreationURL: env.topLevelCreationURL,
          isSecureContext: env.isSecureContext, hasCrossSiteAncestor: env.hasCrossSiteAncestor,
          realmAttached: realm.env === env && realm.baseEnv === env && global.env === env,
          globalNames: [...realm.globalNames], name: env.global.name, selfIsGlobal: env.global.self === env.global,
          type: global.type, credentials: global.credentials, extendedLifetime: global.extendedLifetime,
          hasDocument: Reflect.has(env.global, 'document'), hasWindow: Reflect.has(env.global, 'Window'),
          url: env.global.location.href, executionReady: env.executionReady,
          currentTime: env.currentHighResolutionTime().milliseconds,
          clusterId: runtime.agent.agentCluster.id,
          constructorStorageOrigin: global.constructorStorageKey?.origin,
          sharedServicesError,
        });
        break;
      }
      case 'resolve-module-specifiers': {
        const { parseURL, serializeURL } = loadTypeScript('../../../../src/url/index.ts', __filename);
        const { JavaScriptModuleScript, ScriptFetchOptions } =
          loadTypeScript('../../../../src/browlet/scripting/index.ts', __filename);
        const env = runtime.environment;
        const script = message.referrerURL === undefined ? null
          : new JavaScriptModuleScript('', env, parseURL(message.referrerURL).url, new ScriptFetchOptions());
        runtime.send(message.specifiers.map((specifier) => {
          try { return { url: serializeURL(env.resolveModuleSpecifier(script, specifier)) }; }
          catch (error) { return { error: error.message, realmTypeError: error instanceof env.realm.TypeError }; }
        }));
        break;
      }
      case 'inspect-worker-service-failures': {
        const global = runtime.environment.global;
        const operations = [
          ['createObjectURL', () => global.URL.createObjectURL(new global.Blob(['worker data']))],
          ['BroadcastChannel', () => { new global.BroadcastChannel('worker-service-probe').close(); }],
        ];
        void Promise.all(operations.map(async ([name, run]) => {
          try { await run(); return { name, error: null }; }
          catch (error) { return { name, error: error.message }; }
        })).then((results) => runtime.send(results));
        break;
      }
      case 'inspect-fetch-exposure':
        runtime.send(typeof runtime.environment.global.fetch);
        break;
      case 'inspect-scripting-policy': {
        const { ClassicScript, JavaScriptModuleScript, ScriptFetchOptions } =
          loadTypeScript('../../../../src/browlet/scripting/index.ts', __filename);
        const env = runtime.environment;
        const options = new ScriptFetchOptions();
        // Invalid source distinguishes disabled scripting's empty script from
        // actual parsing. Neither case runs author code or needs shared stores.
        const classic = new ClassicScript('}', env, env.apiBaseURL, options);
        const module = new JavaScriptModuleScript('}', env, env.apiBaseURL, options);
        runtime.send({
          enabled: env.isScriptingEnabled(), canRun: env.canRunScript(),
          classicParseError: classic.parseError !== null, moduleParseError: module.parseError !== null,
        });
        break;
      }
      case 'dispatch-policy-event': {
        const env = runtime.environment;
        // Use the public handler binding and real dispatch; the target's BiDi
        // gate must not require a UserAgent object in this isolate.
        env.global.onerror = realm.evaluate('event => { globalThis.policyEventType = event.type; }');
        env.globalImplementation.fireEvent('error');
        runtime.send(env.global.policyEventType);
        break;
      }
      case 'nested':
        void inspectNestedWorker(runtime, message.url).catch((error) => {
          runtime.send({ error: error.stack });
        });
        break;
      case 'nested-error':
        void runNestedWorkerError(runtime).catch((error) => runtime.send({ error: error.stack }));
        break;
      case 'inspect-policy': {
        const container = runtime.creatorPolicyContainer;
        const list = container.cspList;
        const url = parseURL(message.url).url;
        runtime.send({
          snapshot: container.clone().toSnapshot(),
          policies: list.policies.map((policy) => {
            const directive = policy.directives.getFetchDirective('worker-src');
            return {
              disposition: policy.disposition,
              matches: directive === undefined || policy.directives.get(directive).matchesURL(url, list.selfOrigin, 0),
            };
          }),
        });
        break;
      }
      case 'fetch-script':
        try { runtime.fetchScript(); }
        catch (error) { runtime.send({ errorMessage: error.message }); }
        break;
      case 'capture-module-url': {
        capturedModuleURL = runtime.environment.parseURL(message.url);
        runtime.send({ captured: capturedModuleURL.blobURLEntry !== null });
        break;
      }
      case 'revoke-blob':
        runtime.environment.global.URL.revokeObjectURL(message.url);
        runtime.send('revoked');
        break;
      case 'create-blob-url': {
        const env = runtime.environment;
        const global = runtime.environment.global;
        try {
          let blob;
          if (message.hostSource) {
            const { BlobData, BlobImpl } = loadTypeScript('../../../../src/file/index.ts', __filename);
            const source = {
              size: 1, snapshotState: { version: 1 },
              read: () => Promise.resolve(Uint8Array.of(65)),
            };
            blob = env.project(BlobImpl.create(BlobData.fromSource(source), 'text/plain', source.snapshotState, env));
          } else {
            blob = new global.Blob(['prefix:worker bytes:suffix'], { type: 'text/plain' }).slice(7, 19, 'text/plain');
          }
          runtime.send(global.URL.createObjectURL(blob));
        } catch (error) { runtime.send({ error: error.message, name: error.name }); }
        break;
      }
      case 'fetch-modules': {
        const { serializeURL } = loadTypeScript('../../../../src/url/index.ts', __filename);
        const replies = [];
        message.requests.forEach((request, index) => {
          if (message.captured) request.url = capturedModuleURL;
          else if (runtime.environment !== null) request.url = runtime.environment.parseURL(serializeURL(request.url));
          runtime.fetchModuleScript(request, (response, bodyBytes) => {
            if (message.state !== undefined) Atomics.add(message.state, 0, 1);
            replies.push({
              index, ownsNetworkingTask: runtime.agent.eventLoop.currentlyRunningTask?.source === networkingTaskSource,
              type: response.type, status: response.status,
              urls: response.urlList.map((url) => serializeURL(url)),
              hasBlobEntry: response.urlList.some((url) => url.blobURLEntry !== null),
              headers: [...response.headerList], bodyBytes,
              scriptRan: realm.globalObject.scriptRan === true,
              environment: {
                url: serializeURL(runtime.environment.apiBaseURL),
                policyContainer: runtime.environment.policyContainer.toSnapshot(),
              },
            });
            if (replies.length === message.requests.length) runtime.send(replies);
          });
        });
        break;
      }
      case 'echo':
        runtime.send(message.data);
        break;
      case 'checkpoint': {
        const trace = ['task'];
        runtime.agent.eventLoop.queueMicrotask(() => { trace.push('microtask'); });
        runtime.agent.eventLoop.queueTask(followupTaskSource, null, () => {
          trace.push('next task');
          runtime.send(trace);
        });
        break;
      }
      case 'block':
        realm.globalObject.state = message.state;
        runtime.send('entering loop');
        // Source evaluation and uninterruptible execution are the behavior under test.
        realm.evaluate('try { Atomics.store(state, 0, 1); for (;;) {} } finally { Atomics.store(state, 1, 1); }', 'worker-block.js');
        break;
      case 'read-owner-while-blocked':
        realm.globalObject.state = message.state;
        realm.evaluate('Atomics.store(state, 0, 1); while (Atomics.load(state, 1) === 0) {}', 'worker-owner-read.js');
        runtime.send({ activelyNeeded: runtime.environment.globalImplementation.isActivelyNeeded() });
        break;
      case 'block-worker-script':
        runBlockingWorkerScript(runtime, message.state, message.scriptType, message.entry);
        break;
      case 'report-worker-error':
        runWorkerError(runtime, message, followupTaskSource);
        break;
      case 'report-diagnostics':
        runtime.reportError({ ...message.errorInfo, error: () => 'must not be cloned' });
        runtime.send('reported');
        break;
      case 'round-trip-structured-data':
        roundTripStructuredData(runtime, message);
        break;
      case 'fail':
        throw new Error('worker host task failed');
      case 'close':
        runtime.environment.globalImplementation.close();
        break;
    }
  }, (result) => {
    const { response, bodyBytes, policyContainer, embedderPolicyAllowed } = result;
    let initialized;
    if (runtime.data.initializeScriptResponse) {
      // The production-composed environment reaches the original UserAgent
      // through its service connection; policies still come from this handoff.
      const env = runtime.environment;
      const accepted = env.initializeScriptResponse(result);
      initialized = {
        type: accepted.type, status: accepted.status, url: serializeURL(env.apiBaseURL),
        creationURL: serializeURL(env.creationURL), policies: env.policyContainer.toSnapshot(),
        upgradesInsecureRequests: env.insecureRequestsPolicy.upgrade,
        crossOriginIsolatedCapability: env.crossOriginIsolatedCapability,
        clusterIsolation: runtime.agent.agentCluster.crossOriginIsolationMode,
        executionReady: env.executionReady,
      };
    }
    runtime.send({
      ownsNetworkingTask: runtime.agent.eventLoop.currentlyRunningTask?.source === networkingTaskSource,
      type: response.type, aborted: response.aborted, status: response.status,
      statusMessage: response.statusMessage,
      urls: response.urlList.map((url) => serializeURL(url)),
      hasBlobEntry: response.urlList.some((url) => url.blobURLEntry !== null),
      headers: [...response.headerList], bodyBytes,
      policyContainer: policyContainer?.toSnapshot() ?? null, embedderPolicyAllowed, initialized,
      scriptRan: realm.globalObject.scriptRan === true,
      script: runtime.script,
    });
  });
  traceWorker('runtime ready sent');
}

function prepareWorkerMessages(runtime, portTransfers = false) {
  const env = runtime.environment;
  // This fixture enables script entry explicitly; production still requires
  // owner monitoring before execution readiness and initial script execution.
  env.markExecutionReady();
  // Author callbacks run in the real worker realm and through HTML's script runner.
  const source = portTransfers ? portTransferScript() : `
    globalThis.messageCount = 0;
    onmessage = event => {
      ++messageCount;
      const value = event.data;
      const transfer = value.buffer instanceof ArrayBuffer ? [value.buffer] : [];
      postMessage({
        value, trusted: event.isTrusted, target: event.target === self,
        realm: Object.getPrototypeOf(value) === Object.prototype,
        bufferRealm: value.buffer === undefined || value.buffer instanceof ArrayBuffer,
      }, transfer);
      Promise.resolve().then(() => postMessage({ checkpoint: messageCount }));
    };
    onmessageerror = () => postMessage('messageerror');
  `;
  const script = new ClassicScript(source, env, env.apiBaseURL, new ScriptFetchOptions());
  script.run();
  return env;
}

/** Exercise author close and its final checkpoint without manually disconnecting the native host. */
function closeWorkerMessages(env) {
  const { ClassicScript, ScriptFetchOptions } = loadTypeScript('../../../../src/browlet/scripting/index.ts', __filename);
  const script = new ClassicScript(`
    postMessage('before close');
    close();
    postMessage('after close');
    queueMicrotask(() => postMessage('explicit microtask'));
    Promise.resolve().then(() => postMessage('final microtask'));
  `, env, env.apiBaseURL, new ScriptFetchOptions());
  script.run(true);
}

/** Keep the real browser service connection usable through the final author microtask. */
function closeConfiguredWorker(runtime, blobURL) {
  const { ClassicScript, ScriptFetchOptions } = loadTypeScript('../../../../src/browlet/scripting/index.ts', __filename);
  const env = runtime.environment;
  // Only the fixture advances readiness; production still awaits owner monitoring.
  env.markExecutionReady();
  Reflect.set(env.global, 'record', (value) => runtime.send(value));
  Reflect.set(env.global, 'revocationURL', blobURL);
  const script = new ClassicScript(`
    record('before close');
    close();
    record('after close');
    queueMicrotask(() => {
      URL.revokeObjectURL(revocationURL);
      record('final microtask');
    });
  `, env, env.apiBaseURL, new ScriptFetchOptions());
  script.run(true);
}

/** Author-side control of transferred ports, without bypassing their HTML queues or bindings. */
function portTransferScript() {
  return `
    globalThis.messageCount = 0;
    const ports = new Map();
    function hold(name, port) {
      ports.set(name, port);
      port.addEventListener('message', event => {
        const value = event.data;
        const transfer = [...event.ports];
        if (value?.buffer instanceof ArrayBuffer) transfer.push(value.buffer);
        postMessage({
          type: 'port-message', name, value, trusted: event.isTrusted,
          target: event.target === port, realm: event instanceof MessageEvent,
          nestedIdentity: event.ports.length === 0 || value.port === event.ports[0],
        }, transfer);
        Promise.resolve().then(() => postMessage({ type: 'checkpoint', name }));
      });
      port.onmessageerror = () => postMessage({ type: 'port-error', name });
    }
    onmessage = event => {
      ++messageCount;
      const command = event.data;
      switch (command.type) {
        case 'hold':
          hold(command.name, command.port);
          postMessage({ type: 'held', name: command.name,
            identity: command.port === event.ports[0], realm: command.port instanceof MessagePort,
            frozenPorts: Object.isFrozen(event.ports) });
          break;
        case 'start':
          ports.get(command.name).start();
          postMessage({ type: 'started', name: command.name });
          break;
        case 'send':
          ports.get(command.name).postMessage(command.value);
          postMessage({ type: 'sent', name: command.name });
          break;
        case 'return': {
          const port = ports.get(command.name);
          ports.delete(command.name);
          postMessage({ type: 'returned', port }, [port]);
          break;
        }
        case 'pair':
          hold('sender', command.ports[0]);
          hold('receiver', command.ports[1]);
          command.ports[1].start();
          command.ports[0].postMessage('both ends arrived');
          postMessage({ type: 'pair', identities: command.ports.every((port, i) => port === event.ports[i]) });
          break;
        case 'create': {
          const channel = new MessageChannel();
          hold('created', channel.port1);
          channel.port1.postMessage('queued in worker');
          postMessage({ type: 'created', port: channel.port2 }, [channel.port2]);
          channel.port1.postMessage('sent after transfer');
          break;
        }
        case 'close':
          ports.get(command.name).close();
          ports.delete(command.name);
          postMessage({ type: 'closed', name: command.name });
          break;
      }
    };
    onmessageerror = () => postMessage('messageerror');
  `;
}

function roundTripStructuredData(runtime, message) {
  const env = createFixtureWorkerEnvironment(runtime, 'https://creator.test/clone.js');
  // Fixture-only response capability; production COEP/Permissions Policy setup
  // remains responsible for this decision before serializing shared memory.
  env.realm.crossOriginIsolated = runtime.creatorEnvSnapshot.crossOriginIsolatedCapability &&
    runtime.agent.agentCluster.crossOriginIsolationMode === 'concrete';
  try {
    const { deserialized: value } = env.deserializeWithTransfer(message.serialized);
    let inspection;
    if (message.kind === 'shared-memory') {
      const view = new env.realm.Uint8Array(value.buffer);
      view[0] = 77;
      inspection = { realm: value.buffer instanceof env.realm.SharedArrayBuffer };
    } else if (message.kind === 'wasm') {
      const wasm = env.global.WebAssembly;
      inspection = { realm: value.module instanceof wasm.Module, result: new wasm.Instance(value.module).exports.read() };
    } else {
      inspection = { realm: Object.getPrototypeOf(value) === env.realm.objectPrototype };
    }
    runtime.send({ inspection, serialized: env.serializeWithTransfer(value, []) });
  } catch (error) {
    runtime.send({
      error: { name: error.name, message: error.message },
      transferByteLengths: message.serialized.transferDataHolders
        .filter((holder) => holder.type === 'ArrayBuffer' || holder.type === 'ResizableArrayBuffer')
        .map((holder) => holder.buffer.byteLength),
    });
  }
}

async function runNestedWorkerError(runtime) {
  traceWorker('nested-error request received');
  const env = createFixtureWorkerEnvironment(runtime, 'https://creator.test/parent.js');
  env.markExecutionReady();
  traceWorker('parent environment ready');
  const events = [];
  env.global.addEventListener('error', (event) => { events.push({ message: event.message, error: event.error }); });
  const worker = new WorkerImpl(env);
  const child = new WorkerThread({
    kind: 'dedicated', data: { traceTiming }, creatorEnv: env, worker,
    script: { url: env.parseURL('https://creator.test/child.js'), type: 'classic', credentials: 'same-origin', name: '' },
  }, () => {});
  traceWorker('child created');
  env.globalImplementation.reportErrorToOwner = (errorInfo) => {
    traceWorker('parent forwards child error');
    runtime.reportError(errorInfo);
    traceWorker('child termination requested');
    void child.terminate().then(() => {
      traceWorker('child terminated; reply sent');
      runtime.send(events);
    });
  };
  await child.ready;
  traceWorker('child ready observed');
  child.send({ type: 'report-worker-error', scriptType: 'classic' });
}

function runWorkerError(runtime, message, followupTaskSource) {
  traceWorker('error request received');
  const env = createFixtureWorkerEnvironment(runtime, 'https://creator.test/error.js', message.scriptType);
  env.markExecutionReady();
  traceWorker('error environment ready');
  env.globalImplementation.reportErrorToOwner = (errorInfo) => {
    traceWorker('child reports error');
    runtime.reportError(errorInfo);
  };
  const events = [];
  env.global.addEventListener('error', (event) => {
    events.push({ message: event.message, errorType: typeof event.error, trusted: event.isTrusted });
    if (message.cancelInside) event.preventDefault();
  });
  // A function cannot cross native structured cloning. It must remain available
  // locally while outside delivery carries only its diagnostic string.
  const source = 'const failure = function workerFailure() {}; failure.toString = () => "worker failed"; throw failure;';
  const script = message.scriptType === 'module'
    ? new JavaScriptModuleScript(source, env, env.apiBaseURL, new ScriptFetchOptions())
    : new ClassicScript(source, env, env.apiBaseURL, new ScriptFetchOptions(), message.muted === true);
  if (message.scriptType === 'module') script.record.link();
  script.run();
  traceWorker('error script returned');
  // Module rejection reporting finishes at the checkpoint before this reply.
  runtime.agent.eventLoop.queueTask(followupTaskSource, null, () => runtime.send(events));
}

/** Schedule through the projected worker API and observe delivery on the HTML timer queue. */
function startTimers(runtime, { state, timeout }) {
  const env = runtime.environment;
  env.markExecutionReady();
  env.global.timerState = state;
  env.global.timerDelay = timeout;
  env.global.isTimerTask = () => runtime.agent.eventLoop.currentlyRunningTask?.timerNestingLevel === 1;
  env.realm.evaluate(`(${function () {
    globalThis.timerCalls = 0;
    const start = globalThis.performance.now();
    globalThis.workerTimerId = globalThis.setTimeout(() => {
      globalThis.timerCalls++;
      globalThis.timerElapsed = globalThis.performance.now() - start;
      globalThis.ownsTimerTask = globalThis.isTimerTask();
      Atomics.store(globalThis.timerState, 1, globalThis.timerCalls);
    }, globalThis.timerDelay);
  }.toString()})()`, 'worker-timers.js');
}

/** Execute through HTML's script runner in the actual production-composed environment. */
function runSuspendableScript(runtime, { state, entry = 'script', closeFirst = false }) {
  const { ClassicScript, ScriptFetchOptions } = loadTypeScript('../../../../src/browlet/scripting/index.ts', __filename);
  const env = runtime.environment;
  env.markExecutionReady();
  env.global.state = state;
  env.global.reportSuspension = (order) => runtime.send({
    order, activelyNeeded: env.globalImplementation.isActivelyNeeded(),
  });
  // started, finish request, progress, finally, sibling, dependent.
  // These scripts deliberately block: native suspension is the behavior under test.
  const loop = `
    ${closeFirst ? 'close();' : ''}
    Atomics.store(state, 0, 1);
    try { while (Atomics.load(state, 1) === 0) Atomics.add(state, 2, 1); }
    finally { Atomics.store(state, 3, 1); order.push('finally'); }
    order.push('return');
  `;
  const source = entry === 'reaction' ? `
    const order = [];
    const first = Promise.resolve().then(() => { ${loop} });
    Promise.resolve().then(() => { Atomics.store(state, 4, 1); order.push('sibling'); });
    first.then(() => { Atomics.store(state, 5, 1); order.push('dependent'); reportSuspension(order); });
  ` : `const order = []; ${loop} reportSuspension(order);`;
  new ClassicScript(source, env, env.apiBaseURL, new ScriptFetchOptions(), false).run();
}

function runBlockingWorkerScript(runtime, state, scriptType, entry = 'script') {
  const env = createFixtureWorkerEnvironment(runtime, 'https://creator.test/blocked.js', scriptType);
  env.markExecutionReady();
  env.global.state = state;
  env.global.announce = () => runtime.send('entering worker script');
  env.global.onerror = () => { Atomics.store(state, 4, 1); return true; };
  // These are actual HTML script runners in the worker environment. The shared
  // array observes what survives native interruption without requiring delivery
  // of another message from the blocked worker.
  const loop = `
    try {
      announce();
      Atomics.store(state, 0, 1);
      for (;;) {}
    } catch {
      Atomics.store(state, 1, 1);
    } finally {
      Atomics.store(state, 2, 1);
    }
  `;
  let source;
  if (entry === 'reaction') {
    source = `
      Promise.resolve().then(() => { ${loop} });
      Promise.resolve().then(() => Atomics.store(state, 3, 1));
    `;
  } else if (entry === 'callback') {
    source = `
      Promise.resolve().then(() => Atomics.store(state, 3, 1));
      addEventListener('abort-probe', () => { ${loop} });
      addEventListener('abort-probe', () => Atomics.store(state, 5, 1));
      dispatchEvent(new Event('abort-probe'));
    `;
  } else {
    source = `Promise.resolve().then(() => Atomics.store(state, 3, 1)); ${loop}`;
  }
  if (entry !== 'script') {
    // A later HTML task must be discarded too; restoring a healthy callback or
    // promise checkpoint would be the wrong contract for Worker.terminate().
    env.queueTask('dom-manipulation', () => { Atomics.store(state, 5, 1); });
  }
  const Script = scriptType === 'classic' ? ClassicScript : JavaScriptModuleScript;
  const script = new Script(source, env, env.apiBaseURL, new ScriptFetchOptions());
  if (scriptType === 'module') script.record.link();
  void script.run();
}

async function inspectNestedWorker(runtime, url) {
  const creatorEnv = createFixtureWorkerEnvironment(runtime, url);
  const reply = Promise.withResolvers();
  const child = new WorkerThread({
    kind: 'dedicated', data: {}, creatorEnv,
    script: { url: creatorEnv.parseURL('https://creator.test/child.js'), type: 'classic', credentials: 'same-origin', name: '' },
  }, reply.resolve);
  let result;
  try {
    await child.ready;
    child.send({ type: 'inspect' });
    result = {
      parentThreadId: threadId,
      parentEnvSnapshot: WorkerThread.captureCreatorEnvironment(creatorEnv),
      retainedOwner: child.owner === creatorEnv.globalImplementation,
      child: await reply.promise,
    };
  } finally {
    await child.terminate();
  }
  runtime.send(result);
}

// Fixture-only composition: a local UserAgent/Window supplies facilities that
// cross-isolate service transport does not implement yet. It is not a remote
// owner or a cloned UserAgent. No fetching, storage, or lifetime service is used.
// The actual received Origin records and runtime cluster feed a real worker
// environment, which then creates a child through the production host adapter.
function createFixtureWorkerEnvironment(runtime, url, type = 'classic', initializePolicies = true) {
  traceWorker('environment construction starts');
  const creator = runtime.creatorEnvSnapshot;
  const userAgent = new UserAgent();
  const agent = new WindowAgent(new EventLoop({ requestTurn() {} }));
  new AgentCluster().add(agent);
  const creationURL = creator.creationURL;
  const outsideEnv = createWindowEnvironment({
    agent, userAgent, creationURL, origin: creator.origin, parent: null,
    topLevelCreationURL: creator.topLevelCreationURL,
    topLevelOrigin: creator.topLevelOrigin,
  });
  const document = outsideEnv.createDocument();
  document.origin = creator.origin;
  document.url = creationURL;
  document.policyContainer = runtime.creatorPolicyContainer.clone();
  outsideEnv.window.setAssociatedDocument(document);
  traceWorker('fixture Window ready');
  const env = createWorkerEnvironment({
    agent: runtime.agent, outsideEnv, url: parseURL(url).url, unsafeWorkerCreationTime: 1234,
    type, name: 'worker fixture', credentials: 'same-origin', extendedLifetime: false,
  });
  // Apply the real local/response policy selection without pretending to fetch.
  // In particular, data workers inherit their owner's copied policy container.
  if (initializePolicies) {
    const response = new FetchResponse();
    response.urlList.push(env.apiBaseURL);
    env.globalImplementation.initializePolicyContainer(response, env);
  }
  traceWorker('fixture worker environment ready');
  return env;
}

function traceWorker(phase) {
  if (traceTiming) {
    // hrtime uses the same monotonic clock across these isolates; console delivery
    // can reorder lines, so compare timestamps rather than printed order.
    console.error(JSON.stringify({ workerTiming: phase, threadId, ms: Number(process.hrtime.bigint()) / 1e6 }));
  }
}
