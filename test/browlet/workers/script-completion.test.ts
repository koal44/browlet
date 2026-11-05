import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import { utf8Encode } from '../../../src/encoding/index';
import { FetchHeaders } from '../../../src/fetch/index';
import { parseURL, serializeURL } from '../../../src/url/index';
import { Browlet } from '../../../src/browlet/browlet';
import { MessagePortImpl } from '../../../src/browlet/communication/index';
import type { EventTargetImpl } from '../../../src/browlet/dom/events/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import {
  ClassicScript, DedicatedWorkerAgent, SharedWorkerAgent, ScriptFetchOptions,
  domManipulationTaskSource, type EventLoop,
} from '../../../src/browlet/scripting/index';
import { DedicatedWorkerGlobalImpl, type WorkerType } from '../../../src/browlet/workers/index';
import type { Event, MessageEvent, MessagePort } from '../../../src/browlet/platform';
import { mockHTTPTransport } from '../../fetch/transport-fixture';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

afterEach(() => vi.restoreAllMocks());

describe('Worker initial fetch completion (HTML §10.2.4)', () => {
  it.each([
    { shared: false, failure: 'network' }, { shared: true, failure: 'network' },
    { shared: false, failure: 'parse' }, { shared: true, failure: 'parse' },
  ])('discards on $failure failure and queues an ordinary outside error (shared: $shared)', async ({ shared, failure }) => {
    const { browser, env, outsideEnv, outsidePort, target, worker } = await createStartup(shared);
    await runInHostTask(() => {
      const script = failure === 'network' ? null
        : new ClassicScript('const = ;', env, env.apiBaseURL, new ScriptFetchOptions());
      if (script !== null) expect(script.errorToRethrow).not.toBeNull();
      const errors: Event[] = [];
      target.addEventListener('error', (event) => {
        expect(env.discarded).toBe(true);
        expect(outsideEnv.responsibleEventLoop.currentlyRunningTask?.source).toBe(domManipulationTaskSource);
        errors.push(event);
      });
      const report = vi.spyOn(env, 'reportException');
      env.queueTask('network', () => { env.completeScriptFetch(script, worker, outsidePort); });
      expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
      expect(env.discarded).toBe(true);
      expect(env.executionReady).toBe(false);
      expect(errors).toEqual([]);
      expect(report).not.toHaveBeenCalled();
      expect(env.globalImplementation.ports).toEqual([]);
      expect(outsidePort.isEntangledOutsideGlobal()).toBe(false);
      drain(outsideEnv.responsibleEventLoop);
      expect(errors).toHaveLength(1);
      expect(Object.getPrototypeOf(errors[0])).toBe(browser.window.Event.prototype);
      expect(errors[0]).toMatchObject({ type: 'error', target, isTrusted: true, bubbles: false, cancelable: false });
    });
  });

  it('reuses the dedicated inside port and entangles it before running the initial script', async () => {
    const { env, outsideEnv, outsidePort, outside, worker } = await createStartup();
    await runInHostTask(() => {
      const global = env.globalImplementation;
      assert(global instanceof DedicatedWorkerGlobalImpl);
      const originalInsidePort = global.insidePort;
      const messages: unknown[] = [];
      outside.addEventListener('message', (event) => { messages.push((event as MessageEvent).data); });
      const script = new ClassicScript(`
        onmessage = event => postMessage(event.data);
        postMessage('initial');
      `, env, env.apiBaseURL, new ScriptFetchOptions());
      env.queueTask('network', () => { env.completeScriptFetch(script, worker, outsidePort); });
      env.responsibleEventLoop.runTaskTurn();
      expect(global.insidePort).toBe(originalInsidePort);
      expect(global.ports).toEqual([originalInsidePort]);
      expect(env.executionReady).toBe(true);
      expect(env.discarded).toBe(false);
      drain(outsideEnv.responsibleEventLoop);
      expect(messages).toEqual(['initial']);
      outside.postMessage('echo');
      drain(env.responsibleEventLoop);
      drain(outsideEnv.responsibleEventLoop);
      expect(messages).toEqual(['initial', 'echo']);
    });
  });

  it('creates a shared connection port and delivers it after the initial script', async () => {
    const { env, outsideEnv, outsidePort, outside, worker } = await createStartup(true);
    await runInHostTask(() => {
      const messages: unknown[] = [];
      outside.addEventListener('message', (event) => { messages.push((event as MessageEvent).data); });
      expect(env.globalImplementation.ports).toEqual([]);
      const script = new ClassicScript(`
        onconnect = event => {
          const port = event.ports[0];
          port.onmessage = message => port.postMessage(message.data);
          port.postMessage('connected');
        };
      `, env, env.apiBaseURL, new ScriptFetchOptions());
      env.queueTask('network', () => { env.completeScriptFetch(script, worker, outsidePort); });
      env.responsibleEventLoop.runTaskTurn();
      expect(env.globalImplementation.ports).toHaveLength(1);
      expect(messages).toEqual([]);
      outside.postMessage('waiting for connect');
      drain(env.responsibleEventLoop);
      drain(outsideEnv.responsibleEventLoop);
      expect(messages).toEqual(['connected', 'waiting for connect']);
    });
  });

  it.each(['classic', 'module'] as const)('connects a fetched %s script to execution and messaging', async (type) => {
    const { env, outsideEnv, outsidePort, outside, worker } = await createStartup(false, type);
    mockHTTPTransport(outsideEnv.userAgent, (_request, listener) => {
      listener.onHeaders(200, '', new FetchHeaders([['Content-Type', 'text/javascript']]), true);
      listener.onData(utf8Encode("postMessage('loaded');"));
      listener.onEnd();
    });
    const delivered = new Promise<unknown>((resolve) => {
      outside.addEventListener('message', (event) => { resolve((event as MessageEvent).data); }, { once: true });
    });
    env.fetchScript(outsideEnv, 'same-origin', (script) => { env.completeScriptFetch(script, worker, outsidePort); });
    expect(await delivered).toBe('loaded');
    expect(env.executionReady).toBe(true);
    expect(env.discarded).toBe(false);
  });

  it.each(['syntax', 'link'] as const)('discards a fetched module graph with a %s error before execution', async (failure) => {
    const { browser, env, outsideEnv, outsidePort, target, worker } = await createStartup(false, 'module');
    mockHTTPTransport(outsideEnv.userAgent, (request, listener) => {
      const source = serializeURL(request.url).endsWith('/dependency.js') ? 'export const other = 1;'
        : failure === 'syntax' ? 'const = ;' : "import { missing } from './dependency.js'; postMessage('must not run');";
      listener.onHeaders(200, '', new FetchHeaders([['Content-Type', 'text/javascript']]), true);
      listener.onData(utf8Encode(source));
      listener.onEnd();
    });
    const error = new Promise<Event>((resolve) => { target.addEventListener('error', resolve, { once: true }); });
    env.fetchScript(outsideEnv, 'same-origin', (script) => { env.completeScriptFetch(script, worker, outsidePort); });
    expect(Object.getPrototypeOf(await error)).toBe(browser.window.Event.prototype);
    expect(env.discarded).toBe(true);
    expect(env.executionReady).toBe(false);
    expect(env.globalImplementation.ports).toEqual([]);
  });
});

/** The outside EventTarget exercises delivery; public Worker construction is a separate dependency. */
async function createStartup(shared = false, type: WorkerType = 'classic') {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://worker.test/page');
  const outsideEnv = getRelevantRealm(browser.window).env;
  const agent = outsideEnv.userAgent.obtainDedicatedOrSharedWorkerAgent(outsideEnv, shared);
  assert(agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent);
  const env = createWorkerEnvironment({
    agent, outsideEnv, url: parseURL('https://worker.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
    type, name: 'completion test', credentials: 'same-origin', extendedLifetime: false,
  });
  const target = new browser.window.EventTarget();
  const worker = unwrap<EventTargetImpl>(target);
  const outsidePort = new MessagePortImpl(outsideEnv);
  const outside = outsideEnv.project(outsidePort) as MessagePort;
  return { browser, env, outsideEnv, outsidePort, outside, target, worker };
}

function drain(loop: EventLoop): void {
  while (loop.runTaskTurn()) { /* Drain runnable messages and completion tasks. */ }
}
