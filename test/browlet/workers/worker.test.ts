import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { ContentSecurityPolicy } from '../../../src/browlet/browsing/policy/csp/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import { ClassicScript, DedicatedWorkerAgent, ScriptFetchOptions, SharedWorkerAgent, type EventLoop } from '../../../src/browlet/scripting/index';
import { DedicatedWorkerGlobalImpl, WorkerImpl } from '../../../src/browlet/workers/index';
import type { DedicatedWorkerGlobalScope, MessageEvent, MessagePort, SharedWorkerGlobalScope, Window, Worker } from '../../../src/browlet/platform';
import { obtainURLOrigin, parseURL } from '../../../src/url/index';

import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';
import { runInHostTask } from '../../support/tasks';
import { useFixture } from '../../support/fixture';

afterEach(() => vi.restoreAllMocks());

describe('Worker outside interface (HTML §10.2.6.3)', () => {
  const prepared = useFixture(() => createOutsideWorker());

  it('projects an EventTarget with the two mixins and keeps its outside port private', () => {
    const { worker, window, env } = prepared();
    expect(worker).toBeInstanceOf(window.Worker);
    expect(worker).toBeInstanceOf(window.EventTarget);
    expect(Object.prototype.toString.call(worker)).toBe('[object Worker]');
    expect(window.Worker.length).toBe(1);
    expect(window.Worker.prototype.postMessage.length).toBe(1);
    expect(window.Worker.prototype.terminate.length).toBe(0);
    for (const name of ['outsidePort', 'thread', 'eventHandlers', 'abstractWorkerMixin', 'messageEventTargetMixin', 'initialize']) {
      expect(Reflect.has(worker, name)).toBe(false);
    }
    for (const name of ['onmessage', 'onmessageerror', 'onerror']) {
      expect(Reflect.get(worker, name)).toBeNull();
      expect(Object.hasOwn(worker, name)).toBe(false);
      expect(Object.getOwnPropertyDescriptor(window.Worker.prototype, name)).toMatchObject({ enumerable: true, configurable: true });
    }
    const terminate = Reflect.get(worker, 'terminate');
    expect(() => { Reflect.apply(terminate, {}, []); }).toThrow(env.realm.TypeError);
  });

  it.each([false, true])('exposes nested Worker construction in a worker global (shared: %s)', (shared) => {
    const { env } = prepared();
    const agent = shared ? new SharedWorkerAgent(createManualEventLoop()) : new DedicatedWorkerAgent(createManualEventLoop());
    env.realm.agent.agentCluster!.add(agent);
    const insideEnv = createWorkerEnvironment({
      agent, outsideEnv: env, url: parseURL('https://creator.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
      type: 'classic', name: '', credentials: 'same-origin', extendedLifetime: false,
    });
    const scope = insideEnv.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope;
    expect(typeof scope.Worker).toBe('function');
    expect(() => { new scope.Worker('http://['); }).toThrow(insideEnv.DOMException);
    expect(() => { new scope.Worker('./nested.js'); })
      .toThrow('Nested worker startup requires ownership and direct browser-service forwarding');
  });

  it('uses ordinary constructor arity and WorkerOptions enum conversion', () => {
    const { window, env } = prepared();
    expect(() => { Reflect.construct(window.Worker, []); }).toThrow(env.realm.TypeError);
    expect(() => { Reflect.apply(window.Worker, undefined, ['http://[']); }).toThrow(env.realm.TypeError);
    for (const options of [{ type: 'invalid' }, { credentials: 'invalid' }, 1]) {
      expect(() => { Reflect.construct(window.Worker, ['http://[', options]); }).toThrow(env.realm.TypeError);
    }
  });

  it('finishes URL-string and dictionary conversion before rejecting a malformed URL', () => {
    const { window, env } = prepared();
    const order: string[] = [];
    const scriptURL = { toString() { order.push('scriptURL'); return 'http://['; } };
    const options = {
      get credentials() { order.push('credentials'); return 'include'; },
      get name() { order.push('name'); return 'named'; },
      get type() { order.push('type'); return 'module'; },
    };
    expect(() => { Reflect.construct(window.Worker, [scriptURL, options]); })
      .toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    expect(order).toEqual(['scriptURL', 'credentials', 'name', 'type']);
    expect(() => { new window.Worker('http://['); }).toThrow(env.DOMException);
  });

  it('enforces TrustedScriptURL before parsing and reports the Worker constructor sink', () => {
    const { window, env } = prepared();
    env.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse("require-trusted-types-for 'script'", 'header', 'enforce'));
    expect(() => { new window.Worker('http://['); }).toThrow(env.realm.TypeError);
    const calls: unknown[][] = [];
    window.trustedTypes.createPolicy('default', {
      createScriptURL(input: string, ...args: unknown[]) { calls.push([input, ...args]); return 'http://['; },
    });
    expect(() => { new window.Worker('/\uD800.js'); }).toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    expect(calls).toEqual([['/\uFFFD.js', 'TrustedScriptURL', 'Worker constructor']]);
  });

  it('unwraps a matching trusted URL without calling the default policy', () => {
    const { window, env } = prepared();
    env.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse("require-trusted-types-for 'script'", 'header', 'enforce'));
    const marker = new Error('default policy must not run');
    window.trustedTypes.createPolicy('default', { createScriptURL() { throw marker; } });
    const policy = window.trustedTypes.createPolicy('worker-url', { createScriptURL: (input) => input });
    expect(() => { new window.Worker(policy.createScriptURL('http://[')); })
      .toThrow(expect.objectContaining({ name: 'SyntaxError' }));
  });

  it.each([false, true])('uses ordinary outside error cancellation for %s', (result) => {
    const { worker, window } = prepared();
    const calls: unknown[][] = [];
    worker.onerror = function(this: unknown, ...args: unknown[]) { calls.push([this, ...args]); return result; };
    const event = new window.ErrorEvent('error', { cancelable: true, error: null });
    expect(worker.dispatchEvent(event)).toBe(result !== false);
    expect(calls).toEqual([[worker, event]]);
    expect(event.defaultPrevented).toBe(result === false);
  });
});

describe('Worker outside interface (HTML §10.2.6.3) connected messages', () => {
  const prepared = useFixture(() => createConnectedWorker());

  it('clones outgoing messages synchronously and delivers them in order to the inside global', () => {
    const { worker, scope, inside, insideLoop } = prepared();
    const messages: MessageEvent[] = [];
    scope.onmessage = (event) => { messages.push(event as MessageEvent); };
    inside.insidePort.start();
    const data = { value: 'before', self: null as unknown };
    data.self = data;
    expect(worker.postMessage(data)).toBeUndefined();
    data.value = 'after';
    worker.postMessage(undefined);
    expect(messages).toEqual([]);
    drain(insideLoop);
    expect(messages).toHaveLength(2);
    const copy = messages[0]!.data as typeof data;
    expect(copy).not.toBe(data);
    expect(copy.value).toBe('before');
    expect(copy.self).toBe(copy);
    expect(messages[0]!.target).toBe(scope);
    expect(messages[1]!.data).toBeUndefined();
  });

  it.each(['sequence', 'options'] as const)('transfers a port through the %s overload', (overload) => {
    const { worker, window, scope, inside, insideLoop, loop } = prepared();
    const channel = new window.MessageChannel();
    let received: MessagePort | undefined;
    const replies: unknown[] = [];
    channel.port1.onmessage = (event) => { replies.push((event as MessageEvent).data); };
    scope.onmessage = (event) => {
      const message = event as MessageEvent;
      received = message.data as MessagePort;
      expect(message.ports).toEqual([received]);
      received.postMessage('through transferred port');
    };
    inside.insidePort.start();
    if (overload === 'sequence') worker.postMessage(channel.port2, [channel.port2]);
    else worker.postMessage(channel.port2, { transfer: [channel.port2] });
    drain(insideLoop);
    expect(received).not.toBe(channel.port2);
    drain(loop);
    expect(replies).toEqual(['through transferred port']);
  });

  it('keeps incoming messages disabled despite onmessage until startup enables the outside port', () => {
    const { worker, implementation, scope, loop } = prepared();
    const messages: unknown[] = [];
    worker.onmessage = function(this: unknown, event) {
      const message = event as MessageEvent;
      messages.push([this, message.target, message.data, message.origin, message.source, message.ports.length, message.isTrusted]);
    };
    scope.postMessage('waiting');
    drain(loop);
    expect(messages).toEqual([]);
    implementation.outsidePort.start();
    drain(loop);
    expect(messages).toEqual([[worker, worker, 'waiting', '', null, 0, true]]);
  });

  it('delivers messageerror to the Worker when deserialization fails', () => {
    const { worker, implementation, scope, env, loop } = prepared();
    const messages: unknown[] = [];
    worker.onmessageerror = function(this: unknown, event) {
      const message = event as MessageEvent;
      messages.push([this, message.target, message.type, message.data, message.isTrusted]);
    };
    vi.spyOn(env, 'deserializeWithTransfer').mockImplementationOnce(() => { throw new Error('cannot deserialize'); });
    implementation.outsidePort.start();
    scope.postMessage('message');
    drain(loop);
    expect(messages).toEqual([[worker, worker, 'messageerror', null, true]]);
  });

  it('delivers initial-script messages to the Worker through existing completion steps', () => runInHostTask(() => {
    const { worker, implementation, insideEnv, loop, insideLoop } = prepared();
    const messages: unknown[] = [];
    worker.onmessage = (event) => { messages.push((event as MessageEvent).data); };
    const script = new ClassicScript("postMessage('initial script');", insideEnv, insideEnv.apiBaseURL, new ScriptFetchOptions());
    insideEnv.queueTask('network', {
      run: () => {
        const global = insideEnv.globalImplementation;
        const insidePort = global.connectPort(implementation.outsidePort);
        global.runScript(script, insidePort, () => { implementation.outsidePort.start(); });
      },
    });
    expect(insideLoop.runTaskTurn()).toBe(true);
    expect(insideEnv.executionReady).toBe(true);
    expect(messages).toEqual([]);
    drain(loop);
    expect(messages).toEqual(['initial script']);
  }));
});

describe('Worker outside interface (HTML §10.2.6.3) across environments', () => {
  const prepared = useFixture(() => [createOutsideWorker(), createConnectedWorker()] as const);

  it('uses the receiver port across realms and preserves synchronous conversion and clone errors', () => {
    const first = prepared()[0];
    const second = prepared()[1];
    const messages: unknown[] = [];
    second.scope.onmessage = (event) => { messages.push((event as MessageEvent).data); };
    second.inside.insidePort.start();
    const postMessage = Reflect.get(first.worker, 'postMessage');
    Reflect.apply(postMessage, second.worker, ['second worker']);
    drain(second.insideLoop);
    expect(messages).toEqual(['second worker']);
    expect(() => { Reflect.apply(postMessage, {}, ['message']); }).toThrow(first.env.realm.TypeError);
    expect(() => { Reflect.apply(postMessage, first.worker, []); }).toThrow(first.env.realm.TypeError);
    expect(() => { Reflect.apply(postMessage, first.worker, ['message', 1]); }).toThrow(first.env.realm.TypeError);
    expect(() => { first.worker.postMessage(() => {}); }).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    const buffer = new ArrayBuffer(1);
    expect(() => { first.worker.postMessage(buffer, [buffer, buffer]); }).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    expect(buffer.byteLength).toBe(1);
  });

});

/** Construct only the outside implementation; production startup remains an explicit dependency. */
function createOutsideWorker() {
  const userAgent = createManualUserAgent();
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const env = traversable.activeWindow!.env;
  const document = traversable.activeDocument!;
  document.url = parseURL('https://creator.test/page').url!;
  document.origin = obtainURLOrigin(document.url);
  const window = env.global as unknown as Window;
  const implementation = new WorkerImpl(env);
  const worker = env.project(implementation) as Worker;
  return { worker, implementation, env, window, loop: env.responsibleEventLoop };
}

/** Real bindings, settings, and ports in two local agents; this does not simulate isolate transport. */
function createConnectedWorker() {
  const fixture = createOutsideWorker();
  const agent = new DedicatedWorkerAgent(createManualEventLoop());
  fixture.env.realm.agent.agentCluster!.add(agent);
  const insideEnv = createWorkerEnvironment({
    agent, outsideEnv: fixture.env, url: parseURL('https://creator.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
    type: 'classic', name: '', credentials: 'same-origin', extendedLifetime: false,
  });
  const inside = insideEnv.globalImplementation;
  assert(inside instanceof DedicatedWorkerGlobalImpl);
  inside.connectPort(fixture.implementation.outsidePort);
  const scope = insideEnv.global as unknown as DedicatedWorkerGlobalScope;
  return { ...fixture, insideEnv, inside, scope, insideLoop: agent.eventLoop };
}

function drain(loop: EventLoop): void {
  while (loop.runTaskTurn()) { /* Drain runnable tasks without bypassing port queue enablement. */ }
}
