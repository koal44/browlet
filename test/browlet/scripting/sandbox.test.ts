import { describe, expect, it, vi } from 'vitest';
import { getBindingContext } from '../../../src/browlet/bindings';
import { SandboxAgent } from '../../../src/browlet/scripting/agents';
import { Realm } from '../../../src/browlet/scripting/realm';
import { networkingTaskSource } from '../../../src/browlet/scripting/tasks';
import { UserAgent } from '../../../src/browlet/user-agent';
import { FetchBody } from '../../../src/fetch/body';

describe('Browser-owned sandbox execution', () => {
  it('reuses one environment per user agent without a Window or HTML settings object', () => {
    const first = new UserAgent();
    const second = new UserAgent();
    const env = first.sandbox;
    const realm = Realm.getAssociatedRealm(env.exec.global)!;
    const other = Realm.getAssociatedRealm(second.sandbox.exec.global)!;
    expect(first.sandbox).toBe(env);
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

  it('runs owner tasks and their Promise continuations without manual checkpoints', async () => {
    const env = new UserAgent().sandbox;
    const realm = Realm.getAssociatedRealm(env.exec.global)!;
    const pending = env.exec.promises.withResolvers<number>();
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
