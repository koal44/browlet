import { assert, describe, expect, it, vi } from 'vitest';

import { parseURL } from '../../../src/url/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { MessagePortImpl } from '../../../src/browlet/communication/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import {
  AgentCluster, ClassicScript, DedicatedWorkerAgent, ScriptFetchOptions, SharedWorkerAgent,
} from '../../../src/browlet/scripting/index';
import type { DedicatedWorkerGlobalScope, MessageEvent, MessagePort, SharedWorkerGlobalScope } from '../../../src/browlet/platform';
import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';
import { runInHostTask } from '../../support/tasks';

describe('Worker event-loop shutdown (HTML §§8.1.7.3, 10.2.4)', () => {
  it.each([false, true])('finishes the current script and microtasks before releasing resources (shared: %s)', (shared) => runInHostTask(() => {
    const { env, loop, global, outsideEnv, insidePort, outsidePort, outside } = createWorker(shared);
    const timers = env.getWindowOrWorkerGlobalScopeMixin().timers;
    timers.setTimeout(() => {}, 100, []);
    timers.setInterval(() => {}, 200, []);
    const states: boolean[][] = [];
    const messages: unknown[] = [];
    outside.addEventListener('message', (event) => { messages.push((event as MessageEvent).data); });
    Reflect.set(env.global, 'observe', () => {
      states.push([global.ownerSet.size > 0, insidePort.isEntangledOutsideGlobal(), timers.hasOutstandingTimers()]);
    });
    Reflect.set(env.global, 'send', (message: string) => { insidePort.postMessage(message, []); });
    const script = new ClassicScript(`
      send('script');
      close();
      observe();
      Promise.resolve().then(() => { send('microtask'); observe(); });
    `, env, env.apiBaseURL, new ScriptFetchOptions());
    env.queueTask('network', () => { env.runScript(script, outsidePort, insidePort); });
    expect(loop.runTaskTurn()).toBe(true);
    expect(states).toEqual([[true, true, true], [true, true, true]]);
    expect(global.ownerSet.size).toBe(0);
    expect(global.ports).toEqual([]);
    expect(outsidePort.isEntangledOutsideGlobal()).toBe(false);
    expect(timers.hasOutstandingTimers()).toBe(false);
    expect(timers.getNextTimeoutDeadline()).toBeNull();
    while (outsideEnv.responsibleEventLoop.runTaskTurn()) { /* Deliver messages already sent before shutdown. */ }
    expect(messages).toEqual(['script', 'microtask']);
  }));

  it('drains old tasks when only the closing flag is set, then releases resources', () => runInHostTask(() => {
    const { env, loop, global } = createWorker();
    const trace: string[] = [];
    env.queueTask('network', () => { trace.push('first'); });
    env.queueTask('timer', () => { trace.push('second'); });
    global.closing = true;
    env.queueTask('network', () => { trace.push('discarded'); });
    expect(loop.runTaskTurn()).toBe(true);
    expect(global.ownerSet.size).toBe(1);
    expect(loop.runTaskTurn()).toBe(true);
    expect(trace).toEqual(['first', 'second']);
    expect(global.ownerSet.size).toBe(0);
    expect(loop.runTaskTurn()).toBe(false);
  }));

  it('can clear a dedicated worker’s pending outside deliveries before shutdown disentangles it', () => runInHostTask(() => {
    const { env, loop, scope, outsideEnv, insidePort, outsidePort, outside } = createWorker();
    const messages: unknown[] = [];
    outside.onmessage = (event) => { messages.push((event as MessageEvent).data); };
    const script = new ClassicScript(`postMessage('queued');`, env, env.apiBaseURL, new ScriptFetchOptions());
    env.queueTask('network', () => { env.runScript(script, outsidePort, insidePort); });
    loop.runTaskTurn();
    // The messaging step only: native script abortion and the outside Worker
    // association are still dependencies of the full termination algorithm.
    insidePort.clearOutgoingMessages();
    env.queueTask('network', () => { scope.close(); });
    loop.runTaskTurn();
    while (outsideEnv.responsibleEventLoop.runTaskTurn()) { /* Drain the outside queue. */ }
    expect(messages).toEqual([]);
    expect(outsidePort.isEntangledOutsideGlobal()).toBe(false);
  }));

  it('waits for a disabled port queue instead of treating no runnable tasks as an empty loop', () => runInHostTask(() => {
    const { loop, global, insidePort, outside } = createWorker();
    outside.postMessage('waiting');
    global.closing = true;
    expect(loop.runTaskTurn()).toBe(false);
    expect(global.ownerSet.size).toBe(1);
    expect(global.ports).toHaveLength(1);
    insidePort.start();
    expect(loop.runTaskTurn()).toBe(true);
    expect(global.ownerSet.size).toBe(0);
    expect(global.ports).toEqual([]);
  }));

  it('wakes an idle loop for close without destroying it synchronously', () => runInHostTask(() => {
    const { global, scope, runHostTurns } = createWorker();
    scope.close();
    expect(global.ownerSet.size).toBe(1);
    runHostTurns();
    expect(global.ownerSet.size).toBe(0);
    expect(global.ports).toEqual([]);
  }));

  it('finishes a worker closed during an external microtask checkpoint', () => runInHostTask(() => {
    const { env, global, scope, runHostTurns } = createWorker();
    env.responsibleEventLoop.queueMicrotask(() => {
      scope.close();
      expect(global.ownerSet.size).toBe(1);
    });
    runHostTurns();
    expect(global.ownerSet.size).toBe(0);
  }));

  it('does not run later tasks or microtasks after the loop is destroyed', () => runInHostTask(() => {
    const { env, loop, scope, runHostTurns } = createWorker();
    env.queueTask('network', () => { scope.close(); });
    loop.runTaskTurn();
    const late = vi.fn();
    env.queueTask('network', late);
    loop.queueMicrotask(late);
    loop.performMicrotaskCheckpoint();
    runHostTurns();
    expect(loop.runTaskTurn()).toBe(false);
    expect(late).not.toHaveBeenCalled();
  }));

  it('does not revive a destroyed loop when a spun task becomes ready', () => runInHostTask(() => {
    const { env, loop, scope, runHostTurns } = createWorker();
    let resume: (() => void) | undefined;
    const continuation = vi.fn();
    env.queueTask('network', () => { loop.spinUntil((ready) => { resume = ready; }, continuation); });
    loop.runTaskTurn();
    runHostTurns();
    assert(resume !== undefined);
    env.queueTask('network', () => { scope.close(); });
    loop.runTaskTurn();
    resume();
    runHostTurns();
    expect(continuation).not.toHaveBeenCalled();
  }));

  it('disconnects an external peer in transit without disconnecting local-only channels', () => runInHostTask(() => {
    const { env, loop, global, scope, outsideEnv, insidePort, outside } = createWorker();
    const localFirst = new MessagePortImpl(env);
    const localSecond = new MessagePortImpl(env);
    localFirst.entangle(localSecond);
    const transferred = outsideEnv.serializeWithTransfer(outside, [outside]);
    expect(insidePort.isEntangledOutsideGlobal()).toBe(true);
    env.queueTask('network', () => { scope.close(); });
    loop.runTaskTurn();
    const received = outsideEnv.deserializeWithTransfer(transferred).deserialized as MessagePort;
    expect(global.ports).toEqual([]);
    expect(insidePort.isEntangledOutsideGlobal()).toBe(false);
    expect(outsideEnv.getWindowOrWorkerGlobalScopeMixin().messagePorts.size).toBe(0);
    expect(env.getWindowOrWorkerGlobalScopeMixin().messagePorts).toEqual(new Set([localFirst, localSecond]));
    expect(() => { received.postMessage('no recipient'); }).not.toThrow();
  }));
});

/** Real worker environments and ports, with host turns retained for deterministic shutdown boundaries. */
function createWorker(shared = false) {
  const userAgent = createManualUserAgent();
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const outsideEnv = traversable.activeWindow!.env;
  const turns: (() => void)[] = [];
  const loop = createManualEventLoop({ requestTurn: (steps) => { turns.push(steps); } });
  const agent = shared ? new SharedWorkerAgent(loop) : new DedicatedWorkerAgent(loop);
  (shared ? new AgentCluster() : outsideEnv.realm.agent.agentCluster!).add(agent);
  const env = createWorkerEnvironment({
    agent, outsideEnv, url: parseURL('https://worker.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
    type: 'classic', name: 'shutdown test', credentials: 'same-origin', extendedLifetime: false,
  });
  const global = env.globalImplementation;
  const outsidePort = new MessagePortImpl(outsideEnv);
  const insidePort = global.connectPort(outsidePort);
  return {
    env, loop, global, outsideEnv, insidePort, outsidePort,
    scope: env.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope,
    outside: outsideEnv.project(outsidePort) as MessagePort,
    runHostTurns: () => {
      while (turns.length > 0) turns.shift()!();
    },
  };
}
