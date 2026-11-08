import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { ContentSecurityPolicy } from '../../../src/browlet/browsing/policy/csp/index';
import { MessagePortImpl } from '../../../src/browlet/communication/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import {
  ClassicScript, DedicatedWorkerAgent, SharedWorkerAgent, ScriptFetchOptions, type EventLoop,
} from '../../../src/browlet/scripting/index';
import { SharedWorkerImpl } from '../../../src/browlet/workers/index';
import type { Event, MessageEvent, SharedWorker, Window } from '../../../src/browlet/platform';
import { obtainURLOrigin, parseURL } from '../../../src/url/index';

import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';
import { runInHostTask } from '../../support/tasks';

afterEach(() => vi.restoreAllMocks());

describe('SharedWorker outside interface (HTML §10.2.6.4)', () => {
  it('projects a Window-only EventTarget with a stable, read-only MessagePort', () => {
    const { worker, implementation, window } = createOutsideSharedWorker();
    expect(worker).toBeInstanceOf(window.SharedWorker);
    expect(worker).toBeInstanceOf(window.EventTarget);
    expect(Object.prototype.toString.call(worker)).toBe('[object SharedWorker]');
    expect(window.SharedWorker.length).toBe(1);
    expect(worker.port).toBeInstanceOf(window.MessagePort);
    expect(worker.port).toBe(worker.port);
    expect(worker.port).toBe(implementation.env.project(implementation.port));
    const descriptor = Object.getOwnPropertyDescriptor(window.SharedWorker.prototype, 'port');
    expect(typeof descriptor?.get).toBe('function');
    expect(descriptor).toMatchObject({ set: undefined, configurable: true, enumerable: true });
    expect(Reflect.set(worker, 'port', null)).toBe(false);
    expect(worker.onerror).toBeNull();
    for (const name of ['postMessage', 'terminate', 'onmessage', 'onmessageerror', 'initialize', 'eventHandlers', 'abstractWorkerMixin']) {
      expect(Reflect.has(worker, name)).toBe(false);
    }
  });

  it.each([false, true])('does not expose SharedWorker inside workers (shared: %s)', (shared) => {
    const { env } = createOutsideSharedWorker();
    const agent = shared ? new SharedWorkerAgent(createManualEventLoop()) : new DedicatedWorkerAgent(createManualEventLoop());
    env.realm.agent.agentCluster!.add(agent);
    const insideEnv = createWorkerEnvironment({
      agent, outsideEnv: env, url: parseURL('https://creator.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
      type: 'classic', name: '', credentials: 'same-origin', extendedLifetime: false,
    });
    expect(Reflect.has(insideEnv.global, 'SharedWorker')).toBe(false);
    expect(Reflect.has(insideEnv.global, 'Worker')).toBe(true);
  });

  it('requires construction, a URL argument, and valid dictionary enums', () => {
    const { window, env } = createOutsideSharedWorker();
    expect(() => { Reflect.construct(window.SharedWorker, []); }).toThrow(env.realm.TypeError);
    expect(() => { Reflect.apply(window.SharedWorker, undefined, ['http://[']); }).toThrow(env.realm.TypeError);
    for (const options of [{ type: 'invalid' }, { credentials: 'invalid' }, Symbol('name')]) {
      expect(() => { Reflect.construct(window.SharedWorker, ['http://[', options]); }).toThrow(env.realm.TypeError);
    }
  });

  it('converts inherited dictionary members before the extension and before parsing the URL', () => {
    const { window } = createOutsideSharedWorker();
    const order: string[] = [];
    const scriptURL = { toString() { order.push('scriptURL'); return 'http://['; } };
    const options = {
      get credentials() { order.push('credentials'); return 'include'; },
      get name() { order.push('name'); return 'named'; },
      get type() { order.push('type'); return 'module'; },
      get extendedLifetime() { order.push('extendedLifetime'); return true; },
      toString() { throw new Error('An options object must use dictionary conversion'); },
    };
    expect(() => { Reflect.construct(window.SharedWorker, [scriptURL, options]); })
      .toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    expect(order).toEqual(['scriptURL', 'credentials', 'name', 'type', 'extendedLifetime']);
  });

  it.each(['named', 7, false, null, undefined])('accepts the name/dictionary union before URL validation (%s)', (options) => {
    const { window, env } = createOutsideSharedWorker();
    expect(() => { Reflect.construct(window.SharedWorker, ['http://[', options]); })
      .toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    expect(() => { new window.SharedWorker('http://['); }).toThrow(env.DOMException);
  });

  it('propagates dictionary access failures without reaching Trusted Types or URL parsing', () => {
    const { window, env } = createOutsideSharedWorker();
    env.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse("require-trusted-types-for 'script'", 'header', 'enforce'));
    const marker = new Error('options getter');
    const options = { get extendedLifetime(): boolean { throw marker; } };
    expect(() => { new window.SharedWorker('http://[', options); }).toThrow(marker);
  });

  it('enforces TrustedScriptURL before parsing and identifies the SharedWorker sink', () => {
    const { window, env } = createOutsideSharedWorker();
    env.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse("require-trusted-types-for 'script'", 'header', 'enforce'));
    expect(() => { new window.SharedWorker('http://['); }).toThrow(env.realm.TypeError);
    const calls: unknown[][] = [];
    window.trustedTypes.createPolicy('default', {
      createScriptURL(input: string, ...args: unknown[]) { calls.push([input, ...args]); return 'http://['; },
    });
    expect(() => { new window.SharedWorker('/\uD800.js'); }).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    expect(calls).toEqual([['/\uFFFD.js', 'TrustedScriptURL', 'SharedWorker constructor']]);
  });

  it('accepts a matching trusted URL without invoking the default policy', () => {
    const { window, env } = createOutsideSharedWorker();
    env.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse("require-trusted-types-for 'script'", 'header', 'enforce'));
    window.trustedTypes.createPolicy('default', { createScriptURL() { throw new Error('default policy must not run'); } });
    const policy = window.trustedTypes.createPolicy('shared-worker-url', { createScriptURL: (input) => input });
    expect(() => { new window.SharedWorker(policy.createScriptURL('http://[')); })
      .toThrow(expect.objectContaining({ name: 'SyntaxError' }));
  });

  it('uses the receiver connection when its port getter is borrowed across realms', () => {
    const first = createOutsideSharedWorker();
    const second = createOutsideSharedWorker();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Apply the borrowed getter with an explicit receiver.
    const getter = Object.getOwnPropertyDescriptor(first.window.SharedWorker.prototype, 'port')!.get!;
    const port: unknown = Reflect.apply(getter, second.worker, []);
    expect(port).toBe(second.worker.port);
    expect(port).toBeInstanceOf(second.window.MessagePort);
    expect(port).not.toBeInstanceOf(first.window.MessagePort);
    expect(() => { Reflect.apply(getter, {}, []); }).toThrow(first.env.realm.TypeError);
  });

  it.each([false, true])('uses ordinary outside error cancellation for %s', (result) => {
    const { worker, window } = createOutsideSharedWorker();
    const calls: unknown[][] = [];
    worker.onerror = function(this: unknown, ...args: unknown[]) { calls.push([this, ...args]); return result; };
    const event = new window.ErrorEvent('error', { cancelable: true, error: null });
    expect(worker.dispatchEvent(event)).toBe(result !== false);
    expect(calls).toEqual([[worker, event]]);
    expect(event.defaultPrevented).toBe(result === false);
  });

  it('keeps messages on the port and leaves listener-based delivery disabled until start', () => {
    const { worker, implementation, env, loop } = createOutsideSharedWorker();
    const peer = new MessagePortImpl(env);
    implementation.port.entangle(peer);
    const messages: MessageEvent[] = [];
    const workerMessages: Event[] = [];
    worker.addEventListener('message', (event) => { workerMessages.push(event); });
    worker.port.addEventListener('message', (event) => { messages.push(event as MessageEvent); });
    peer.postMessage('waiting', []);
    drain(loop);
    expect(messages).toEqual([]);
    worker.port.start();
    drain(loop);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ data: 'waiting', target: worker.port, isTrusted: true });
    expect(workerMessages).toEqual([]);
    worker.port.close();
    peer.close();
  });

  it('connects the outside object to existing initial-script completion and port messaging', () => runInHostTask(() => {
    const { worker, implementation, env, loop } = createOutsideSharedWorker();
    const agent = new SharedWorkerAgent(createManualEventLoop());
    const insideEnv = createWorkerEnvironment({
      agent, outsideEnv: env, url: parseURL('https://creator.test/shared.js').url!, unsafeWorkerCreationTime: 1234,
      type: 'classic', name: 'shared', credentials: 'same-origin', extendedLifetime: false,
    });
    const messages: unknown[] = [];
    worker.port.onmessage = (event) => { messages.push((event as MessageEvent).data); };
    const script = new ClassicScript(`
      onconnect = event => {
        const port = event.ports[0];
        port.onmessage = message => port.postMessage(message.data);
        port.postMessage('connected');
      };
    `, insideEnv, insideEnv.apiBaseURL, new ScriptFetchOptions());
    insideEnv.queueTask('network', {
      run: () => {
        const global = insideEnv.globalImplementation;
        const insidePort = global.connectPort(implementation.port);
        global.runScript(script, insidePort, () => { implementation.port.start(); });
      },
    });
    expect(insideEnv.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(messages).toEqual([]);
    worker.port.postMessage('waiting for connect');
    drain(insideEnv.responsibleEventLoop);
    drain(loop);
    expect(messages).toEqual(['connected', 'waiting for connect']);
    worker.port.close();
    insideEnv.globalImplementation.close();
    drain(insideEnv.responsibleEventLoop);
  }));
});

/** Project the real outside implementation without pretending discovery or isolate startup exists. */
function createOutsideSharedWorker() {
  const userAgent = createManualUserAgent();
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const env = traversable.activeWindow!.env;
  const document = traversable.activeDocument!;
  document.url = parseURL('https://creator.test/page').url!;
  document.origin = obtainURLOrigin(document.url);
  const window = env.global as unknown as Window;
  const implementation = new SharedWorkerImpl(env);
  const worker = env.project(implementation) as SharedWorker;
  return { worker, implementation, env, window, loop: env.responsibleEventLoop };
}

/** Advance only runnable tasks; startup and message queue activation stay explicit in each test. */
function drain(loop: EventLoop): void {
  while (loop.runTaskTurn()) { /* Drain runnable messages and completion tasks. */ }
}
