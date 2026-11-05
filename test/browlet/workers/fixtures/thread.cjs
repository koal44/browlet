'use strict';
/* global __filename, process */

const { threadId, isMainThread, workerData } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
// JS Engine's envelope contains the original browser startup inputs.
const initialization = workerData.data;
const { mode, state } = initialization.data;
if (mode === 'throw-before-ready') throw new Error('bootstrap failed');
if (mode === 'exit-before-ready') process.exit(0);
if (mode === 'wait-before-ready') {
  Atomics.store(state, 0, 1);
  Atomics.wait(state, 1, 0);
}

// Trusted test bootstrap, loaded in an actual Node worker. tsx only loads source
// files for this fixture; production startup reloads the existing package bundle.
// These tests deliberately terminate isolates. tsx's background disk-cache writes
// can still be pending then, leaving open files that delay Windows process exit.
// Keep its in-memory transform cache, without starting that unrelated disk I/O.
process.env.TSX_DISABLE_CACHE = '1';
const { requireTypeScript: loadTypeScript } = require('../../../support/typescript.cjs');
const { WorkerThread, WorkerThreadRuntime } = loadTypeScript('../../../../src/browlet/integration/host/index.ts', __filename);
const {
  AgentCluster, BrowletRealm, EventLoop, SharedWorkerAgent, WindowAgent, createTaskSource, networkingTaskSource,
} = loadTypeScript('../../../../src/browlet/scripting/index.ts', __filename);
const { addon, JSThread } = loadTypeScript('../../../../src/js-engine/index.ts', __filename);

// Descendants reload this fixture too. This replaces only the entry registration,
// without mocking the transport, runtime, agent allocation, or environment capture.
JSThread.initialize(pathToFileURL(__filename).href, startFixture);

function startFixture() {
  const runtime = new WorkerThreadRuntime();

  // This deliberately has no WorkerGlobalScope/settings. The fixture exercises
  // engine context allocation and task ownership before that integration exists.
  const realm = new BrowletRealm({ agent: runtime.agent });
  realm.initialize();
  const followupTaskSource = createTaskSource('worker fixture continuation');
  runtime.start((message) => {
    switch (message.type) {
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
      case 'nested':
        void inspectNestedWorker(runtime, message.url).catch((error) => {
          runtime.send({ error: error.stack });
        });
        break;
      case 'inspect-policy': {
        const { parseURL } = loadTypeScript('../../../../src/url/index.ts', __filename);
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
      case 'fail':
        throw new Error('worker host task failed');
      case 'disconnect':
        runtime.disconnect();
        break;
    }
  }, ({ response, bodyBytes, blobPolicyContainer }) => {
    const { serializeURL } = loadTypeScript('../../../../src/url/index.ts', __filename);
    runtime.send({
      ownsNetworkingTask: runtime.agent.eventLoop.currentlyRunningTask?.source === networkingTaskSource,
      type: response.type, aborted: response.aborted, status: response.status,
      statusMessage: response.statusMessage,
      urls: response.urlList.map((url) => serializeURL(url)),
      hasBlobEntry: response.urlList.some((url) => url.blobURLEntry !== null),
      headers: [...response.headerList], bodyBytes,
      blobPolicyContainer: blobPolicyContainer?.toSnapshot() ?? null,
      scriptRan: realm.globalObject.scriptRan === true,
    });
  });
}

async function inspectNestedWorker(runtime, url) {
  const creatorEnv = createFixtureWorkerEnvironment(runtime, url);
  const reply = Promise.withResolvers();
  const child = new WorkerThread({ kind: 'dedicated', data: {}, creatorEnv }, reply.resolve);
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
function createFixtureWorkerEnvironment(runtime, url) {
  const { createWindowEnvironment, createWorkerEnvironment } = loadTypeScript('../../../../src/browlet/integration/web-idl/index.ts', __filename);
  const { UserAgent } = loadTypeScript('../../../../src/browlet/user-agent.ts', __filename);
  const { parseURL } = loadTypeScript('../../../../src/url/index.ts', __filename);
  const { FetchResponse } = loadTypeScript('../../../../src/fetch/index.ts', __filename);
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
  const env = createWorkerEnvironment({
    agent: runtime.agent, outsideEnv, url: parseURL(url).url, unsafeWorkerCreationTime: 1234,
    type: 'classic', name: 'nested creator', credentials: 'same-origin', extendedLifetime: false,
  });
  // Apply the real local/response policy selection without pretending to fetch.
  // In particular, data workers inherit their owner's copied policy container.
  const response = new FetchResponse();
  response.urlList.push(env.apiBaseURL);
  env.globalImplementation.initializePolicyContainer(response, env);
  return env;
}
