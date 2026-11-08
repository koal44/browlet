import { assert, describe, expect, it, vi } from 'vitest';

import { parseURL } from '../../../src/url/index';
import type { JSFunction } from '../../../src/js-engine/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { MessagePortImpl } from '../../../src/browlet/communication/index';
import type { WorkerEnvironment } from '../../../src/browlet/workers/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import {
  AgentCluster, ClassicScript, DedicatedWorkerAgent, JavaScriptModuleScript, ScriptFetchOptions, type ModuleScript,
  SharedWorkerAgent, domManipulationTaskSource, type EventLoop,
} from '../../../src/browlet/scripting/index';
import { DedicatedWorkerGlobalImpl } from '../../../src/browlet/workers/index';
import type { MessageEvent, MessagePort, SharedWorkerGlobalScope } from '../../../src/browlet/platform';
import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';
import { runInHostTask } from '../../support/tasks';

describe('Worker initial script execution (HTML §10.2.4)', () => {
  it('marks readiness before classic execution and enables dedicated messages after script cleanup', () => runInHostTask(() => {
    const { env, outsideEnv, insidePort, outsidePort, outside } = createStartup();
    const received: unknown[] = [];
    outside.addEventListener('message', (event) => { received.push((event as MessageEvent).data); });
    outside.postMessage('queued before execution');
    const observations: boolean[][] = [];
    Reflect.set(env.global, 'inspectStartup', () => {
      observations.push([
        env.executionReady,
        env.responsibleEventLoop.hasRunnableTasks(),
        outsideEnv.responsibleEventLoop.hasRunnableTasks(),
      ]);
    });
    const script = classic(env, `
      onmessage = event => postMessage(event.data);
      postMessage('script');
      inspectStartup();
      Promise.resolve().then(() => { postMessage('microtask'); inspectStartup(); });
    `);
    expect(env.executionReady).toBe(false);
    runInitialScript(env, script, outsidePort, insidePort);
    expect(observations).toEqual([[true, false, false], [true, false, false]]);
    expect(received).toEqual([]);
    drain(outsideEnv.responsibleEventLoop);
    expect(received).toEqual(['script', 'microtask']);
    drain(env.responsibleEventLoop);
    drain(outsideEnv.responsibleEventLoop);
    expect(received).toEqual(['script', 'microtask', 'queued before execution']);
  }));

  it('queues a trusted shared connection without automatically starting its inside port', () => runInHostTask(() => {
    const { env, outsidePort, insidePort, inside, outside } = createStartup(true);
    const scope = env.global as unknown as SharedWorkerGlobalScope;
    const received: unknown[] = [];
    let connection: MessageEvent | undefined;
    let ownsTask = false;
    scope.onconnect = (event) => {
      connection = event as MessageEvent;
      ownsTask = env.responsibleEventLoop.currentlyRunningTask?.source === domManipulationTaskSource;
      connection.ports[0]!.addEventListener('message', (message) => { received.push((message as MessageEvent).data); });
    };
    outside.postMessage('waiting for start');
    runInitialScript(env, classic(env, 'globalThis.scriptRan = true;'), outsidePort, insidePort);
    expect(Reflect.get(env.global, 'scriptRan')).toBe(true);
    expect(connection).toBeUndefined();
    drain(env.responsibleEventLoop);
    assert(connection !== undefined);
    expect(ownsTask).toBe(true);
    expect(connection).toBeInstanceOf(scope.MessageEvent);
    expect(connection).toMatchObject({ type: 'connect', data: '', source: inside, isTrusted: true, bubbles: false, cancelable: false });
    expect(connection.ports).toEqual([inside]);
    expect(Object.isFrozen(connection.ports)).toBe(true);
    expect(received).toEqual([]);
    inside.start();
    drain(env.responsibleEventLoop);
    expect(received).toEqual(['waiting for start']);
  }));

  it('retains normal runtime-error reporting and still enables the ports', () => runInHostTask(() => {
    const { env, outsideEnv, insidePort, outsidePort, outside } = createStartup();
    Reflect.set(env.global, 'onerror', () => true);
    const report = vi.spyOn(env, 'reportException');
    const received: unknown[] = [];
    outside.addEventListener('message', (event) => { received.push((event as MessageEvent).data); });
    runInitialScript(env, classic(env, "postMessage('before throw'); throw new Error('initial script failed');"), outsidePort, insidePort);
    expect(report).toHaveBeenCalledOnce();
    expect(env.executionReady).toBe(true);
    expect(env.discarded).toBe(false);
    drain(outsideEnv.responsibleEventLoop);
    expect(received).toEqual(['before throw']);
  }));

  it.each([false, true])('does not wait for top-level await before activating ports, shared: %s', (shared) => runInHostTask(() => {
    const { env, outsideEnv, insidePort, outsidePort, inside, outside } = createStartup(shared, 'module');
    const received: unknown[] = [];
    outside.addEventListener('message', (event) => { received.push((event as MessageEvent).data); });
    if (shared) {
      const scope = env.global as unknown as SharedWorkerGlobalScope;
      scope.onconnect = (event) => { (event as MessageEvent).ports[0]!.postMessage('connected while suspended'); };
    }
    Reflect.set(env.global, 'sendFromScript', (data: unknown) => { inside.postMessage(data); });
    const script = new JavaScriptModuleScript(`
      sendFromScript('before await');
      await new Promise(resolve => { globalThis.resume = resolve; });
      sendFromScript('after await');
    `, env, env.apiBaseURL, new ScriptFetchOptions());
    assert(script.record !== null);
    script.record.link();
    runInitialScript(env, script, outsidePort, insidePort);
    expect(env.executionReady).toBe(true);
    drain(env.responsibleEventLoop);
    drain(outsideEnv.responsibleEventLoop);
    expect(received).toEqual(shared ? ['before await', 'connected while suspended'] : ['before await']);
    Reflect.apply(Reflect.get(env.global, 'resume') as JSFunction, undefined, []);
    env.responsibleEventLoop.performMicrotaskCheckpoint();
    drain(outsideEnv.responsibleEventLoop);
    expect(received.at(-1)).toBe('after await');
  }));

  it.each([false, true])('honors close() during the initial script, shared: %s', (shared) => runInHostTask(() => {
    const { env, outsideEnv, insidePort, outsidePort, outside } = createStartup(shared);
    const received: unknown[] = [];
    outside.addEventListener('message', (event) => { received.push((event as MessageEvent).data); });
    const connect = vi.fn();
    env.globalImplementation.addEventListener('connect', connect);
    Reflect.set(env.global, 'sendFromScript', () => { insidePort.postMessage('last message', []); });
    runInitialScript(env, classic(env, 'sendFromScript(); close();'), outsidePort, insidePort);
    drain(env.responsibleEventLoop);
    drain(outsideEnv.responsibleEventLoop);
    expect(env.globalImplementation.closing).toBe(true);
    expect(received).toEqual(['last message']);
    expect(connect).not.toHaveBeenCalled();
    outside.postMessage('too late');
    expect(env.responsibleEventLoop.hasRunnableTasks()).toBe(false);
  }));

  it.each([false, true])('uses the worker global for bare access without changing explicit receivers, shared: %s', (shared) => runInHostTask(() => {
    const { env, insidePort, outsidePort } = createStartup(shared);
    const observations: unknown[] = [];
    Reflect.set(env.global, 'observe', (...values: unknown[]) => { observations.push(...values); });
    Object.defineProperty(env.global, 'authorGetter', { get(this: object) { return this; } });
    runInitialScript(env, classic(env, `
      const handler = () => true;
      onerror = handler;
      observe(self === globalThis, onerror === handler, authorGetter === globalThis);
    `), outsidePort, insidePort);
    expect(observations).toEqual([true, true, true]);
    const inherited = Object.create(env.global) as object;
    expect(Reflect.get(inherited, 'authorGetter')).toBe(inherited);
    expect(() => { Reflect.get(inherited, 'self'); }).toThrow(env.realm.TypeError);
    expect(() => Reflect.set(inherited, 'onerror', null)).toThrow(env.realm.TypeError);
  }));
});

/** Real realms and bindings with explicit port setup; no public Worker or remote service stand-ins. */
function createStartup(shared = false, type: 'classic' | 'module' = 'classic') {
  const userAgent = createManualUserAgent();
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const outsideEnv = traversable.activeWindow!.env;
  const cluster = outsideEnv.realm.agent.agentCluster!;
  const agent = shared ? new SharedWorkerAgent(createManualEventLoop()) : new DedicatedWorkerAgent(createManualEventLoop());
  (shared ? new AgentCluster() : cluster).add(agent);
  const env = createWorkerEnvironment({
    agent, outsideEnv, url: parseURL('https://creator.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
    type, name: 'script test', credentials: 'same-origin', extendedLifetime: false,
  });
  const insidePort = env.globalImplementation instanceof DedicatedWorkerGlobalImpl
    ? env.globalImplementation.insidePort : new MessagePortImpl(env);
  const outsidePort = new MessagePortImpl(outsideEnv);
  outsidePort.entangle(insidePort);
  return {
    env, outsideEnv, insidePort, outsidePort,
    inside: env.project(insidePort) as MessagePort, outside: outsideEnv.project(outsidePort) as MessagePort,
  };
}

function classic(env: WorkerEnvironment, source: string): ClassicScript {
  const script = new ClassicScript(source, env, env.apiBaseURL, new ScriptFetchOptions());
  expect(script.errorToRethrow).toBeNull();
  return script;
}

/** Initial fetch completion runs on the worker's networking task source. */
function runInitialScript(
  env: WorkerEnvironment, script: ClassicScript | ModuleScript,
  outsidePort: MessagePortImpl, insidePort: MessagePortImpl,
): void {
  env.queueTask('network', { run: () => { env.globalImplementation.runScript(script, insidePort, () => { outsidePort.start(); }); } });
  expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
}

function drain(loop: EventLoop): void {
  while (loop.runTaskTurn()) { /* Drain runnable tasks, leaving disabled port queues intact. */ }
}
