import { describe, expect, it } from 'vitest';

import { SandboxEnvironment, WindowOrWorkerGlobalScopeMixin } from '../../../src/browlet/environment/index';
import { browletBindingWorld, createBrowletEnvironmentInit } from '../../../src/browlet/integration/web-idl/index';
import { BrowletRealm, EventLoop, SharedWorkerAgent, createTaskSource } from '../../../src/browlet/scripting/index';
import { UserAgent } from '../../../src/browlet/user-agent';
import { SharedWorkerGlobalImpl } from '../../../src/browlet/workers/index';
import type { MessageEvent, SharedWorkerGlobalScope } from '../../../src/browlet/platform';
import type { JSFunction } from '../../../src/js-engine/index';
import { StorageKey } from '../../../src/storage/index';
import { obtainURLOrigin, parseURL } from '../../../src/url/index';

import { runInHostTask } from '../../support/tasks';

describe('SharedWorkerGlobalScope (HTML §10.2.1.3)', () => {
  it('projects a nonconstructible shared global with a replaceable name', () => {
    const { scope, implementation, realm } = createWorker();
    expect(scope.self).toBe(scope);
    expect(scope.name).toBe('shared name');
    expect(scope).toBeInstanceOf(scope.SharedWorkerGlobalScope);
    expect(scope).toBeInstanceOf(scope.WorkerGlobalScope);
    const constructor = scope.SharedWorkerGlobalScope as unknown as JSFunction;
    expect(() => { Reflect.construct(constructor, []); }).toThrow(realm.TypeError);
    expect(Reflect.set(scope, 'name', 'author value')).toBe(true);
    expect(scope.name).toBe('author value');
    expect(implementation.name).toBe('shared name');
    expect(Object.getOwnPropertyDescriptor(scope, 'name')).toMatchObject({
      value: 'author value', writable: true, enumerable: true, configurable: true,
    });
    for (const name of [
      'DedicatedWorkerGlobalScope', 'postMessage', 'onmessage', 'onmessageerror', 'insidePort',
      'constructorStorageKey', 'constructorURL', 'credentials', 'extendedLifetime', 'closing',
    ]) {
      expect(Reflect.has(scope, name)).toBe(false);
    }
  });

  it('keeps the constructor identity separate from the final worker URL', () => {
    const { scope, implementation, storageKey, constructorURL, env } = createWorker();
    expect(implementation.constructorStorageKey).toBe(storageKey);
    expect(implementation.constructorURL).toBe(constructorURL);
    expect(implementation.type).toBe('module');
    expect(implementation.credentials).toBe('include');
    expect(implementation.extendedLifetime).toBe(true);
    implementation.url = parseURL('https://worker.test/redirected.js').url!;
    expect(scope.location.href).toBe('https://worker.test/redirected.js');
    expect(implementation.constructorURL).toBe(constructorURL);

    // A data URL must still retain the creating environment's storage key for future matching.
    const dataURL = parseURL('data:text/javascript,0').url!;
    const unstarted = new SharedWorkerGlobalImpl('classic', '', storageKey, dataURL, 'omit', false, env);
    expect(unstarted.constructorStorageKey).toBe(storageKey);
    expect(unstarted.constructorURL).toBe(dataURL);
    expect(unstarted.url).toBeNull();
    expect(unstarted.credentials).toBe('omit');
    expect(unstarted.extendedLifetime).toBe(false);
    expect(unstarted.closing).toBe(false);
  });

  it('receives distinct ports through connect events and communicates through those ports', () => {
    const { scope, loop } = createWorker();
    const first = new scope.MessageChannel();
    const second = new scope.MessageChannel();
    const connections: unknown[] = [];
    const replies: unknown[] = [];
    scope.onconnect = function(this: unknown, event) {
      const message = event as MessageEvent;
      const port = message.ports[0]!;
      connections.push([this, event.target, port]);
      expect(Object.isFrozen(message.ports)).toBe(true);
      port.onmessage = (received) => { port.postMessage((received as MessageEvent).data); };
    };
    first.port2.onmessage = (event) => { replies.push(['first', (event as MessageEvent).data]); };
    second.port2.onmessage = (event) => { replies.push(['second', (event as MessageEvent).data]); };

    // Supply the events manually: run-a-worker/SharedWorker startup does not queue them yet.
    scope.dispatchEvent(new scope.MessageEvent('connect', { ports: [first.port1] }));
    scope.dispatchEvent(new scope.MessageEvent('connect', { ports: [second.port1] }));
    expect(connections).toEqual([[scope, scope, first.port1], [scope, scope, second.port1]]);
    first.port2.postMessage('one');
    second.port2.postMessage('two');
    expect(replies).toEqual([]);
    drain(loop);
    expect(replies).toHaveLength(2);
    expect(replies).toEqual(expect.arrayContaining([['first', 'one'], ['second', 'two']]));
  });

  it('uses normal handler replacement, removal, and activation order for onconnect', () => {
    const { scope } = createWorker();
    const trace: string[] = [];
    expect(scope.onconnect).toBeNull();
    scope.addEventListener('connect', () => { trace.push('before'); });
    scope.onconnect = () => { trace.push('old'); };
    scope.addEventListener('connect', () => { trace.push('after'); });
    scope.onconnect = () => { trace.push('new'); };
    scope.dispatchEvent(new scope.MessageEvent('connect'));
    expect(trace).toEqual(['before', 'new', 'after']);
    scope.onconnect = null;
    scope.onconnect = () => { trace.push('last'); };
    trace.length = 0;
    scope.dispatchEvent(new scope.MessageEvent('connect'));
    expect(trace).toEqual(['before', 'after', 'last']);
    Reflect.set(scope, 'onconnect', 1);
    expect(scope.onconnect).toBeNull();
  });

  it('retains inherited handlers including the worker five-argument onerror rule', () => {
    const { scope } = createWorker();
    const trace: unknown[][] = [];
    scope.ononline = function(this: unknown, event) { trace.push([this, event.type]); };
    scope.dispatchEvent(new scope.Event('online'));
    expect(trace).toEqual([[scope, 'online']]);
    scope.onerror = function(this: unknown, ...args: unknown[]) { trace.push([this, ...args]); return true; };
    const error = {};
    const event = new scope.ErrorEvent('error', {
      cancelable: true, message: 'boom', filename: 'https://worker.test/shared.js', lineno: 3, colno: 7, error,
    });
    expect(scope.dispatchEvent(event)).toBe(false);
    expect(trace[1]).toEqual([scope, 'boom', 'https://worker.test/shared.js', 3, 7, error]);
  });

  it('closes shared-worker queues while the current task and its microtasks finish', () => runInHostTask(() => {
    const { scope, implementation, loop, realm } = createWorker();
    const first = createTaskSource('shared worker first source');
    const second = createTaskSource('shared worker second source');
    const trace: string[] = [];
    realm.queueGlobalTask(first, () => {
      trace.push('before close');
      realm.queueMicrotask(() => { trace.push('microtask'); });
      scope.close();
      scope.close();
      trace.push('after close');
      const dropped = realm.queueGlobalTask(second, () => { trace.push('new task'); });
      expect(dropped.remove()).toBe(false);
    });
    const pending = realm.queueGlobalTask(second, () => { trace.push('old task'); });
    drain(loop);
    expect(implementation.closing).toBe(true);
    expect(pending.remove()).toBe(false);
    expect(trace).toEqual(['before close', 'after close', 'microtask']);
    expect([...loop.getTaskQueues()].every((queue) => queue.size === 0)).toBe(true);
  }));

  it('setting the closing flag alone preserves old tasks but discards new ones (§10.2.2)', () => {
    const { implementation, loop } = createWorker();
    const source = createTaskSource('shared worker task');
    const trace: string[] = [];
    loop.queueTask(source, null, () => { trace.push('old'); });
    implementation.closing = true;
    loop.queueTask(source, null, () => { trace.push('new'); });
    drain(loop);
    expect(trace).toEqual(['old']);
  });
});

/** Resource ownership for real MessagePorts only; this does not implement worker settings. */
class TestEnvironment extends SandboxEnvironment {
  /** Resource-lifetime mixin used by channel entanglement and delivery. */
  #mixin: WindowOrWorkerGlobalScopeMixin | undefined;

  override getWindowOrWorkerGlobalScopeMixin(): WindowOrWorkerGlobalScopeMixin {
    return this.#mixin ??= new WindowOrWorkerGlobalScopeMixin(this);
  }
}

/** Real global projection and agent queues; startup and shared-worker discovery remain dependencies. */
function createWorker() {
  const loop = new EventLoop({ requestTurn() {} });
  const agent = new SharedWorkerAgent(loop);
  const realm = new BrowletRealm({ agent, globalNames: ['Worker', 'SharedWorker'] });
  const context = browletBindingWorld.register(realm, (binding) =>
    new TestEnvironment(realm, createBrowletEnvironmentInit(binding), new UserAgent()),
  );
  const env = context.getEnvironment();
  const storageKey = new StorageKey(obtainURLOrigin(parseURL('https://creator.test/').url!));
  const constructorURL = parseURL('https://worker.test/shared.js').url!;
  const implementation = new SharedWorkerGlobalImpl('module', 'shared name', storageKey, constructorURL, 'include', true, env);
  implementation.url = constructorURL;
  agent.globalScope = implementation;
  realm.initialize({ createGlobalObject: () => context.projectGlobalObject(implementation, 'SharedWorkerGlobalScope') });
  const scope = realm.globalObject as unknown as SharedWorkerGlobalScope;
  return { scope, implementation, loop, realm, env, storageKey, constructorURL };
}

function drain(loop: EventLoop): void {
  while (loop.runTaskTurn()) { /* Run each task and its microtask checkpoint. */ }
}
