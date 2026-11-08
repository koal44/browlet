import { describe, expect, it, vi } from 'vitest';

import { MessagePortImpl } from '../../../src/browlet/communication/index';
import { SandboxEnvironment, WindowOrWorkerGlobalScopeMixin } from '../../../src/browlet/environment/index';
import { browletBindingWorld, createBrowletEnvironmentInit } from '../../../src/browlet/integration/web-idl/index';
import {
  BrowletRealm, DedicatedWorkerAgent, EventLoop, SandboxAgent, createTaskSource,
} from '../../../src/browlet/scripting/index';
import { UserAgent } from '../../../src/browlet/user-agent';
import { DedicatedWorkerGlobalImpl } from '../../../src/browlet/workers/index';
import type { DedicatedWorkerGlobalScope, MessageEvent, MessagePort } from '../../../src/browlet/platform';
import type { JSFunction } from '../../../src/js-engine/index';
import { parseURL } from '../../../src/url/index';

import { runInHostTask } from '../../support/tasks';

describe('DedicatedWorkerGlobalScope (HTML §10.2.1.2)', () => {
  it('projects a nonconstructible global with a replaceable name and a private inside port', () => {
    const { scope, implementation, realm } = createWorker();
    expect(scope.self).toBe(scope);
    expect(scope.name).toBe('worker name');
    expect(scope).toBeInstanceOf(scope.DedicatedWorkerGlobalScope);
    expect(scope).toBeInstanceOf(scope.WorkerGlobalScope);
    const constructor = scope.DedicatedWorkerGlobalScope as unknown as JSFunction;
    expect(() => { Reflect.construct(constructor, []); })
      .toThrow(realm.TypeError);
    expect(Object.hasOwn(scope, 'postMessage')).toBe(true);
    expect(Reflect.set(scope, 'name', 'author value')).toBe(true);
    expect(scope.name).toBe('author value');
    expect(implementation.name).toBe('worker name');
    expect(Object.getOwnPropertyDescriptor(scope, 'name')).toMatchObject({
      value: 'author value', writable: true, enumerable: true, configurable: true,
    });
    for (const name of ['insidePort', 'closing', 'eventHandlers', 'messageEventTargetMixin']) {
      expect(Reflect.has(scope, name)).toBe(false);
    }
  });

  it('clones outgoing messages synchronously and delivers them asynchronously in order', () => {
    const { scope, outside, outsideLoop } = createConnectedWorker();
    const received: MessageEvent[] = [];
    outside.onmessage = (event) => { received.push(event as MessageEvent); };
    const payload = { value: 'before', self: null as unknown };
    payload.self = payload;
    scope.postMessage(payload);
    payload.value = 'after';
    scope.postMessage(undefined);
    expect(received).toEqual([]);
    drain(outsideLoop);
    expect(received).toHaveLength(2);
    const data = received[0]!.data as typeof payload;
    expect(data).not.toBe(payload);
    expect(data.value).toBe('before');
    expect(data.self).toBe(data);
    expect(received[1]!.data).toBeUndefined();
  });

  it.each(['sequence', 'options'] as const)('supports the %s transfer overload', (overload) => {
    const { scope, outside, outsideLoop } = createConnectedWorker();
    const buffer = new ArrayBuffer(4);
    new Uint8Array(buffer)[0] = 37;
    let received: ArrayBuffer | undefined;
    outside.onmessage = (event) => { received = (event as MessageEvent).data as ArrayBuffer; };
    if (overload === 'sequence') scope.postMessage(buffer, [buffer]);
    else scope.postMessage(buffer, { transfer: [buffer] });
    expect(buffer.byteLength).toBe(0);
    drain(outsideLoop);
    expect(new Uint8Array(received!)).toEqual(new Uint8Array([37, 0, 0, 0]));
  });

  it('uses ordinary Web IDL arity, overload conversion, and serialization failures', () => {
    const { scope, realm, env } = createWorker();
    const postMessage = Reflect.get(scope, 'postMessage');
    expect(() => { Reflect.apply(postMessage, scope, []); }).toThrow(realm.TypeError);
    expect(() => { Reflect.apply(postMessage, scope, ['message', 1]); }).toThrow(realm.TypeError);
    expect(() => { scope.postMessage(() => {}); }).toThrow(env.DOMException);
    const buffer = new ArrayBuffer(1);
    expect(() => { scope.postMessage(buffer, [buffer, buffer]); }).toThrow(env.DOMException);
    expect(buffer.byteLength).toBe(1);
  });

  it('uses the receiver\'s hidden port when borrowing postMessage across realms', () => {
    const first = createConnectedWorker();
    const second = createConnectedWorker();
    const received: unknown[] = [];
    second.outside.onmessage = (event) => { received.push((event as MessageEvent).data); };
    const postMessage = Reflect.get(first.scope, 'postMessage');
    Reflect.apply(postMessage, second.scope, ['second']);
    drain(first.outsideLoop);
    expect(received).toEqual([]);
    drain(second.outsideLoop);
    expect(received).toEqual(['second']);
    expect(() => { Reflect.apply(postMessage, {}, ['bad receiver']); }).toThrow(first.realm.TypeError);
  });

  it('keeps incoming delivery disabled until startup enables the inside port', () => {
    const { scope, implementation, outside, loop } = createConnectedWorker();
    const received: unknown[] = [];
    scope.onmessage = function(this: unknown, event) {
      const message = event as MessageEvent;
      received.push([this, event.target, message.data, message.origin, message.source, message.ports.length]);
    };
    outside.postMessage('waiting');
    drain(loop);
    expect(received).toEqual([]);
    implementation.insidePort.start();
    drain(loop);
    expect(received).toEqual([[scope, scope, 'waiting', '', null, 0]]);
  });

  it('delivers deserialization errors to the global through onmessageerror', () => {
    const { scope, implementation, outside, loop, env } = createConnectedWorker();
    const received: unknown[] = [];
    scope.onmessageerror = function(this: unknown, event) {
      const message = event as MessageEvent;
      received.push([this, event.target, event.type, message.data, message.ports.length]);
    };
    const deserialize = vi.spyOn(env, 'deserializeWithTransfer').mockImplementationOnce(() => {
      throw new Error('Receiving-side deserialization failed');
    });
    implementation.insidePort.start();
    outside.postMessage('message');
    drain(loop);
    expect(received).toEqual([[scope, scope, 'messageerror', null, 0]]);
    deserialize.mockRestore();
  });

  it('closes all task sources while allowing the current task and its microtasks to finish', () => runInHostTask(() => {
    const { scope, implementation, loop, realm } = createWorker();
    const first = createTaskSource('first worker source');
    const second = createTaskSource('second worker source');
    const trace: string[] = [];
    expect(implementation.closing).toBe(false);
    realm.queueGlobalTask(first, {
      run: () => {
        trace.push('before close');
        realm.queueMicrotask(() => { trace.push('microtask'); });
        scope.close();
        scope.close();
        trace.push('after close');
        const dropped = realm.queueGlobalTask(second, { run: () => { trace.push('new task'); } });
        expect(dropped.remove()).toBe(false);
      },
    });
    const pending = realm.queueGlobalTask(second, { run: () => { trace.push('old task'); } });
    drain(loop);
    expect(implementation.closing).toBe(true);
    expect(pending.remove()).toBe(false);
    expect(trace).toEqual(['before close', 'after close', 'microtask']);
    expect([...loop.getTaskQueues()].every((queue) => queue.size === 0)).toBe(true);
  }));

  it('drops incoming messages after close without removing outgoing messages or disabling serialization', () => {
    const { scope, implementation, outside, outsideLoop, loop } = createConnectedWorker();
    const received: unknown[] = [];
    const incoming: unknown[] = [];
    outside.onmessage = (event) => { received.push((event as MessageEvent).data); };
    scope.onmessage = (event) => { incoming.push((event as MessageEvent).data); };
    implementation.insidePort.start();
    outside.postMessage('queued before close');
    scope.postMessage('sent before close');
    scope.close();
    outside.postMessage('sent after close');
    scope.postMessage('sent after close');
    expect(() => { scope.postMessage(() => {}); }).toThrow();
    drain(loop);
    drain(outsideLoop);
    expect(incoming).toEqual([]);
    expect(received).toEqual(['sent before close', 'sent after close']);
  });

  it('setting the closing flag alone preserves old tasks but discards new ones (§10.2.2)', () => {
    const { implementation, loop } = createWorker();
    const source = createTaskSource('worker task');
    const trace: string[] = [];
    loop.queueTask(source, null, { run: () => { trace.push('old'); } });
    implementation.closing = true;
    loop.queueTask(source, null, { run: () => { trace.push('new'); } });
    drain(loop);
    expect(trace).toEqual(['old']);
  });
});

/** Only supplies the resource-lifetime mixin needed by real MessagePorts; this is not worker settings. */
class TestEnvironment extends SandboxEnvironment {
  /** Supplied by the worker global, or allocated locally for the outside test endpoint. */
  globalScopeMixin: WindowOrWorkerGlobalScopeMixin | undefined;

  /** Share the configured resource owner with channel entanglement and delivery. */
  override getWindowOrWorkerGlobalScopeMixin(): WindowOrWorkerGlobalScopeMixin {
    return this.globalScopeMixin ??= new WindowOrWorkerGlobalScopeMixin(this);
  }
}

/** Real global projection and agent queues, with manual setup instead of worker startup/thread transport. */
function createWorker() {
  const loop = new EventLoop({ requestTurn() {} });
  const agent = new DedicatedWorkerAgent(loop);
  const realm = new BrowletRealm({ agent, globalNames: ['Worker', 'DedicatedWorker'] });
  let env!: TestEnvironment;
  const context = browletBindingWorld.register(realm, (binding) => {
    env = new TestEnvironment(realm, createBrowletEnvironmentInit(binding), new UserAgent());
    return env;
  });
  const implementation = new DedicatedWorkerGlobalImpl('classic', 'worker name', env);
  env.globalScopeMixin = implementation.getWindowOrWorkerGlobalScopeMixin();
  implementation.url = parseURL('https://worker.test/main.js').url!;
  agent.globalScope = implementation;
  realm.initialize({ createGlobalObject: () => context.projectGlobalObject(implementation, 'DedicatedWorkerGlobalScope') });
  const scope = realm.globalObject as unknown as DedicatedWorkerGlobalScope;
  return { scope, implementation, agent, loop, realm, context, env };
}

/** Outside channel endpoint in a separate realm/agent; the public Worker constructor remains pending. */
function createConnectedWorker() {
  const worker = createWorker();
  const outsideLoop = new EventLoop({ requestTurn() {} });
  const realm = new BrowletRealm({ agent: new SandboxAgent(outsideLoop), globalNames: ['Worker'] });
  const context = browletBindingWorld.register(realm, (binding) =>
    new TestEnvironment(realm, createBrowletEnvironmentInit(binding), new UserAgent()),
  );
  const outsideImpl = new MessagePortImpl(context.getEnvironment());
  worker.implementation.insidePort.entangle(outsideImpl);
  const outside = context.project(MessagePortImpl, outsideImpl)! as MessagePort;
  return { ...worker, outside, outsideLoop };
}

function drain(loop: EventLoop): void {
  while (loop.runTaskTurn()) { /* Run each task and its microtask checkpoint. */ }
}
