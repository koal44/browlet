import { assert, describe, expect, it, vi } from 'vitest';

import { parseURL, serializeURL } from '../../../src/url/index';
import { utf8Encode } from '../../../src/encoding/index';
import { FetchHeaders, type HTTPTransportListener } from '../../../src/fetch/index';
import { BlobData, BlobImpl, BlobReadFailure } from '../../../src/file/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { EventSourceImpl, MessagePortImpl } from '../../../src/browlet/communication/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import { FileReaderImpl } from '../../../src/browlet/integration/file/index';
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
    env.queueTask('network', () => { env.runScript(script, insidePort, () => { outsidePort.start(); }); });
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
    const finish = vi.fn();
    const { env, loop, global } = createWorker(false, finish);
    const trace: string[] = [];
    env.queueTask('network', () => { trace.push('first'); });
    env.queueTask('timer', () => { trace.push('second'); });
    global.closing = true;
    env.queueTask('network', () => { trace.push('discarded'); });
    expect(loop.runTaskTurn()).toBe(true);
    expect(global.ownerSet.size).toBe(1);
    expect(finish).not.toHaveBeenCalled();
    expect(loop.runTaskTurn()).toBe(true);
    expect(trace).toEqual(['first', 'second']);
    expect(global.ownerSet.size).toBe(0);
    expect(finish).toHaveBeenCalledOnce();
    expect(loop.runTaskTurn()).toBe(false);
    expect(finish).toHaveBeenCalledOnce();
  }));

  it.each([false, true])('releases its host once when worker cleanup throws (shared: %s)', (shared) => runInHostTask(() => {
    const finish = vi.fn();
    const { loop, global } = createWorker(shared, finish);
    const failure = new Error('Worker resource cleanup failed');
    vi.spyOn(global, 'finishRunning').mockImplementationOnce(() => { throw failure; });
    global.closing = true;
    expect(() => loop.runTaskTurn()).toThrow(failure);
    expect(finish).toHaveBeenCalledOnce();
    expect(loop.runTaskTurn()).toBe(false);
    expect(finish).toHaveBeenCalledOnce();
  }));

  it('can clear a dedicated worker’s pending outside deliveries before shutdown disentangles it', () => runInHostTask(() => {
    const { env, loop, scope, outsideEnv, insidePort, outsidePort, outside } = createWorker();
    const messages: unknown[] = [];
    outside.onmessage = (event) => { messages.push((event as MessageEvent).data); };
    const script = new ClassicScript(`postMessage('queued');`, env, env.apiBaseURL, new ScriptFetchOptions());
    env.queueTask('network', () => { env.runScript(script, insidePort, () => { outsidePort.start(); }); });
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
    const finish = vi.fn();
    const { loop, global, insidePort, outside } = createWorker(false, finish);
    outside.postMessage('waiting');
    global.closing = true;
    expect(loop.runTaskTurn()).toBe(false);
    expect(global.ownerSet.size).toBe(1);
    expect(global.ports).toHaveLength(1);
    expect(finish).not.toHaveBeenCalled();
    insidePort.start();
    expect(loop.runTaskTurn()).toBe(true);
    expect(global.ownerSet.size).toBe(0);
    expect(global.ports).toEqual([]);
    expect(finish).toHaveBeenCalledOnce();
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

  it.each([false, true])('stops pending FileReader reads after the final checkpoint (shared: %s)', async (shared) => {
    const { env, loop, scope } = createWorker(shared);
    const other = createWorker();
    let release: (() => void) | undefined;
    const read = vi.fn((_start: number, length: number) => new Promise<Uint8Array>((resolve) => {
      release = () => { resolve(new Uint8Array(length)); };
    }));
    const blob = BlobImpl.create(BlobData.fromSource({
      size: 2 * 65536,
      snapshotState: undefined,
      read,
    }), '', undefined, env);
    const reader = new FileReaderImpl(env);
    const events: string[] = [];
    for (const type of ['loadstart', 'progress', 'load', 'error', 'abort', 'loadend']) {
      reader.addEventListener(type, () => { events.push(type); });
    }
    const otherReader = new other.scope.FileReader();
    const otherLoaded = vi.fn();
    otherReader.onload = otherLoaded;
    otherReader.readAsText(new other.scope.Blob(['independent']));
    reader.readAsText(blob);
    await vi.waitFor(() => { expect(read).toHaveBeenCalledOnce(); });

    const states: number[] = [];
    await runInHostTask(() => {
      env.queueTask('dom-manipulation', () => {
        scope.close();
        states.push(reader.readyState);
        loop.queueMicrotask(() => { states.push(reader.readyState); });
      });
      loop.runTaskTurn();
      expect(states).toEqual([1, 1]);
    });
    expect(reader.readyState).toBe(2);
    expect(reader.result).toBeNull();
    expect(reader.error).toBeNull();
    expect(events).toEqual([]);
    assert(release !== undefined);
    release();
    await vi.waitFor(() => {
      while (other.loop.runTaskTurn()) { /* Complete the independent worker's read. */ }
      expect(otherReader.result).toBe('independent');
    });
    expect(otherLoaded).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    expect(loop.runTaskTurn()).toBe(false);
    expect(events).toEqual([]);
    other.scope.close();
    other.runHostTurns();
  });

  it.each(['load', 'error', 'abort'] as const)('cleans up a FileReader restarted from %s before closing', async (type) => {
    const { env, loop, scope } = createWorker();
    const reader = new FileReaderImpl(env);
    const waiting = BlobImpl.create(BlobData.fromSource({
      size: 1,
      snapshotState: undefined,
      read: () => new Promise<Uint8Array>(() => {}),
    }), '', undefined, env);
    const initial = type === 'error' ? BlobImpl.create(BlobData.fromSource({
      size: 1,
      snapshotState: undefined,
      read: () => Promise.reject(new BlobReadFailure('NotFound')),
    }), '', undefined, env) : new BlobImpl(['first'], {}, env);
    const events: string[] = [];
    if (type === 'abort') reader.onloadstart = () => { reader.abort(); };
    reader.addEventListener(type, () => {
      events.push(type);
      reader.readAsText(waiting);
      scope.close();
    });
    reader.onloadend = () => { events.push('loadend'); };
    reader.readAsText(initial);

    await vi.waitFor(() => {
      while (loop.runTaskTurn()) { /* Deliver the first read and close from its callback. */ }
      expect(events).toEqual([type]);
    });
    expect(reader.readyState).toBe(2);
    expect(reader.result).toBeNull();
    expect(reader.error).toBeNull();
    expect(env.getWindowOrWorkerGlobalScopeMixin().fileReaders.size).toBe(0);
  });

  it.each([false, true])('closes worker-owned EventSources after the final checkpoint (shared: %s)', async (shared) => {
    const { env, loop, scope, outsideEnv } = createWorker(shared);
    env.markExecutionReady();
    const exchanges = new Map<string, EventSourceExchange>();
    const dispatch = vi.spyOn(env.userAgent.httpTransport, 'dispatch').mockImplementation((request, listener) => {
      const abort = vi.fn();
      exchanges.set(serializeURL(request.url), { listener, abort });
      return { pause() {}, resume() {}, abort };
    });
    const retries: { steps: () => void; canceled: boolean; }[] = [];
    const schedule = vi.spyOn(env.userAgent.timerHost, 'scheduleTimeout').mockImplementation((_delay, steps) => {
      const timer = { steps, canceled: false };
      retries.push(timer);
      return { remove() { timer.canceled = true; } };
    });
    const active = new scope.EventSource('https://worker.test/active');
    const retrying = new scope.EventSource('https://worker.test/retry');
    const connecting = new scope.EventSource('https://worker.test/connecting');
    const parent = new EventSourceImpl('https://worker.test/parent', { withCredentials: false }, outsideEnv);
    try {
      await vi.waitFor(() => {
        while (loop.runTaskTurn()) { /* Deliver Fetch preparation. */ }
        while (outsideEnv.responsibleEventLoop.runTaskTurn()) { /* Prepare the creator's independent request. */ }
        expect(exchanges.size).toBe(4);
      });
      const activeExchange = exchanges.get(active.url)!;
      const retryExchange = exchanges.get(retrying.url)!;
      for (const exchange of [activeExchange, retryExchange]) {
        const headers = new FetchHeaders();
        headers.append('Content-Type', 'text/event-stream');
        headers.append('Access-Control-Allow-Origin', '*');
        exchange.listener.onHeaders(200, 'OK', headers, true);
      }
      retryExchange.listener.onEnd();
      await vi.waitFor(() => {
        while (loop.runTaskTurn()) { /* Deliver open and reconnection work. */ }
        expect(active.readyState).toBe(active.OPEN);
        expect(retrying.readyState).toBe(retrying.CONNECTING);
        expect(retries.filter((timer) => !timer.canceled)).toHaveLength(1);
      });
      const lateMessage = vi.fn();
      active.onmessage = lateMessage;
      const states: number[][] = [];
      // Stock Node cannot drain its shared microtask queue recursively from
      // this async test's Promise job. Use the same host boundary as the other shutdown tests.
      await runInHostTask(() => {
        env.queueTask('dom-manipulation', () => {
          scope.close();
          states.push([active.readyState, retrying.readyState, connecting.readyState]);
          loop.queueMicrotask(() => { states.push([active.readyState, retrying.readyState, connecting.readyState]); });
        });
        loop.runTaskTurn();
        expect(states).toEqual([[1, 0, 0], [1, 0, 0]]);
      });
      expect([active.readyState, retrying.readyState, connecting.readyState]).toEqual([2, 2, 2]);
      expect(activeExchange.abort).toHaveBeenCalledOnce();
      expect(exchanges.get(connecting.url)!.abort).toHaveBeenCalledOnce();
      expect(retries.every((timer) => timer.canceled)).toBe(true);
      expect(env.getWindowOrWorkerGlobalScopeMixin().eventSources.size).toBe(0);
      expect(parent.readyState).toBe(0);
      expect(exchanges.get(parent.url)!.abort).not.toHaveBeenCalled();
      activeExchange.listener.onData(utf8Encode('data: too late\n\n'));
      for (const timer of retries) timer.steps();
      await runInHostTask(() => {});
      expect(dispatch).toHaveBeenCalledTimes(4);
      expect(lateMessage).not.toHaveBeenCalled();
    } finally {
      active.close();
      retrying.close();
      connecting.close();
      parent.close();
      dispatch.mockRestore();
      schedule.mockRestore();
    }
  });
});

/** Controlled wire callbacks and cancellation, while the production Fetch/EventSource machinery runs. */
interface EventSourceExchange {
  listener: HTTPTransportListener;
  abort: () => void;
}

/** Real worker environments and ports, with host turns retained for deterministic shutdown boundaries. */
function createWorker(shared = false, onWorkerFinish?: () => void) {
  const userAgent = createManualUserAgent();
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const outsideEnv = traversable.activeWindow!.env;
  const turns: (() => void)[] = [];
  const loop = createManualEventLoop({ requestTurn: (steps) => { turns.push(steps); }, onWorkerFinish });
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
