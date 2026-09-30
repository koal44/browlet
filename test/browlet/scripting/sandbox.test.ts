import { idlType } from '../../../src/web-idl/core/index';
import { describe, expect, it, vi } from 'vitest';
import { createSandboxEnvironment, getBindingContext } from '../../../src/browlet/bindings';
import { unsafeSharedCurrentTime } from '../../../src/browlet/performance/high-resolution-time';
import { SandboxAgent } from '../../../src/browlet/scripting/agents';
import { Realm } from '../../../src/browlet/scripting/realm';
import { networkingTaskSource } from '../../../src/browlet/scripting/tasks';
import { UserAgent } from '../../../src/browlet/user-agent';
import { FetchBody } from '../../../src/fetch/body';
import { createMicrotaskQueue } from '../../../src/js-engine/index';

describe('Browser-owned sandbox execution', () => {
  it('reuses one environment per user agent without a Window or HTML settings object', () => {
    const createQueue = vi.fn(createMicrotaskQueue);
    const requestTurn = vi.fn();
    const first = new UserAgent({
      createMicrotaskQueue: createQueue,
      requestEventLoopTurn: requestTurn,
      unsafeSharedCurrentTime,
    });
    // Construction allocates the sandbox, but an idle loop needs no host turn.
    expect(createQueue).toHaveBeenCalledTimes(1);
    expect(requestTurn).not.toHaveBeenCalled();
    const second = new UserAgent();
    const env = first.sandbox;
    const realm = Realm.getAssociatedRealm(env.exec.global)!;
    const other = Realm.getAssociatedRealm(second.sandbox.exec.global)!;
    expect(first.sandbox).toBe(env);
    expect(createQueue).toHaveBeenCalledTimes(1);
    expect(realm).not.toBe(other);
    expect(realm.agent).toBeInstanceOf(SandboxAgent);
    expect(realm.agent.eventLoop).not.toBe(other.agent.eventLoop);
    expect(realm.agent.eventLoop.started).toBe(true);
    expect(realm.getAssociatedDocument()).toBeNull();
    expect(realm.hostDefined).toBeUndefined();
    expect(realm.globalNames.size).toBe(0);
    expect(Reflect.has(env.exec.global, 'Window')).toBe(false);
    expect(getBindingContext(realm).getEnvironment()).toBe(env);
    expect(first.browsingContextGroupSet.size).toBe(0);
  });

  it('retains the owning UserAgent without inventing browser client settings', () => {
    const userAgent = new UserAgent();
    const env = userAgent.sandbox;
    expect(env.userAgent).toBe(userAgent);
    expect(env.global).toBe(env.exec.global);
    expect(env.topLevelOrigin).toBeNull();
    expect(env.topLevelCreationURL).toBeNull();
    expect(env.getReferrerSource()).toBeNull();
    expect(env.getReportingSource()).toBeNull();
    expect(env.getTraversableForUserPrompts()).toBeNull();
    expect(() => env.origin).toThrow('Sandbox has no origin');
    expect(() => env.apiBaseURL).toThrow('Sandbox has no API base URL');
    expect(() => env.policyContainer).toThrow('Sandbox has no policy container');
    expect(() => env.creationURL).toThrow('Environment has no creation URL');
    expect(() => env.getWindowOrWorkerGlobalScopeMixin()).toThrow('Sandbox has no Window or Worker global scope');
  });

  it('reports a missing UserAgent when a standalone sandbox needs browser services', () => {
    const env = createSandboxEnvironment();
    expect(() => env.userAgent).toThrow('Environment has no UserAgent');
  });

  it('runs owner tasks and their Promise continuations without manual checkpoints', async () => {
    const env = new UserAgent().sandbox;
    const realm = Realm.getAssociatedRealm(env.exec.global)!;
    const pending = env.exec.Promise.withResolvers(idlType.double);
    const done = Promise.withResolvers<number>();
    const trace: string[] = [];
    pending.promise.observe((value) => {
      trace.push('continuation');
      done.resolve(value);
    }, done.reject);
    realm.queueGlobalTask(networkingTaskSource, () => {
      trace.push('task');
      pending.resolve(7);
    });
    expect(trace).toEqual([]);
    expect(await done.promise).toBe(7);
    expect(trace).toEqual(['task', 'continuation']);
  });

  it('allocates and reads a Fetch body through its running owner', async () => {
    const env = new UserAgent().sandbox;
    const realm = Realm.getAssociatedRealm(env.exec.global)!;
    const allocation = vi.spyOn(env.exec.buffers, 'copyUint8Array');
    const body = FetchBody.fromBytes(Uint8Array.of(1, 2, 3), env);
    const done = Promise.withResolvers<Uint8Array>();
    body.readAll(done.resolve, done.reject, env.exec.global);
    expect([...(await done.promise)]).toEqual([1, 2, 3]);
    const chunk = allocation.mock.results[0]!.value as Uint8Array;
    expect(Realm.getAssociatedRealm(chunk)).toBe(realm);
  });
});
