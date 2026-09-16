import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { itPassesWith } from '../test-runtime';
import { BodyRecord } from '../../src/fetch/body';
import type { GlobalObject, PromiseValue, RuntimeContext } from '../../src/js-engine/index';
import {
  defineInterface, idlType, impl, op, promise, BindingWorld,
} from '../../src/web-idl/index';
import { createFetchWindow } from './fetch-fixture';
import { performTestMicrotaskCheckpoint } from './test-runtime';
import { ReadableStreamImpl } from '../../src/streams/index';
import { Browlet } from '../../src/browlet/browlet';
import { getRelevantRealm } from '../../src/browlet/bindings';
import { queueGlobalFetchTask } from '../../src/browlet/integration/fetch';
import { networkingTaskSource } from '../../src/browlet/scripting/tasks';

describe('Fetch body delivery through HTML', () => {
  it('routes a foreign body to the destination Window networking tasks', async () => {
    const source = createFetchWindow();
    const target = createFetchWindow();
    const body = BodyRecord.fromBytes(Uint8Array.of(1, 2), source.context.getRuntime());
    const events: (number[] | string)[] = [];
    const error = vi.fn();
    body.incrementallyRead(
      (bytes) => events.push([...bytes]), () => events.push('end'), error,
      target.realm.global,
    );
    await nextTurn();
    expect(events).toEqual([]);
    expect(source.networkingTasks()).toHaveLength(0);
    expect(target.networkingTasks()).toHaveLength(1);
    expect(target.networkingTasks()[0]!.document).toBe(target.document);

    target.runTask();
    expect(events).toEqual([[1, 2]]);
    expect(target.networkingTasks()).toHaveLength(1);
    expect(target.networkingTasks()[0]!.document).toBe(target.document);
    target.runTask();
    expect(events).toEqual([[1, 2], 'end']);
    expect(error).not.toHaveBeenCalled();
  });

  it('fully reads on the stream realm checkpoint and queues completion as another task', async () => {
    const fixture = createFetchWindow();
    const body = BodyRecord.fromBytes(Uint8Array.of(1, 2), fixture.context.getRuntime());
    await nextTurn();
    const process = vi.fn();
    const error = vi.fn();
    fixture.queueTask(() => body.fullyRead(process, error, fixture.realm.global));

    fixture.runTask();
    expect(process).not.toHaveBeenCalled();
    expect(fixture.networkingTasks()).toHaveLength(1);
    expect(fixture.networkingTasks()[0]!.document).toBe(fixture.document);
    fixture.runTask();
    expect(process).toHaveBeenCalledExactlyOnceWith(Uint8Array.of(1, 2));
    expect(error).not.toHaveBeenCalled();
  });

  it('keeps old Window destinations separate from the retargeted WindowProxy', async () => {
    const browlet = new Browlet({ route: () => '' });
    const proxy = browlet.window;
    const firstRealm = getRelevantRealm(proxy);
    const firstDocument = firstRealm.getAssociatedDocument();

    await browlet.navigate('https://example.test/');

    const secondRealm = getRelevantRealm(proxy);
    expect(browlet.window).toBe(proxy);
    expect(secondRealm).not.toBe(firstRealm);
    const firstTasks = firstRealm.agent.eventLoop.getTaskQueue(networkingTaskSource);
    const secondTasks = secondRealm.agent.eventLoop.getTaskQueue(networkingTaskSource);
    const previousTasks = new Set([...firstTasks, ...secondTasks]);
    queueGlobalFetchTask(firstRealm.global, vi.fn());
    queueGlobalFetchTask(proxy, vi.fn());

    const documents = [...new Set([...firstTasks, ...secondTasks])]
      .filter((task) => !previousTasks.has(task))
      .map((task) => task.document);
    expect(documents).toEqual([firstDocument, secondRealm.getAssociatedDocument()]);
  });

  it('uses HTML parallel scheduling when no task destination is supplied', async () => {
    const fixture = createFetchWindow();
    const body = BodyRecord.fromBytes(Uint8Array.of(1, 2), fixture.context.getRuntime());
    const chunks: number[][] = [];
    const completed = new Promise<void>((resolve, reject) => {
      body.incrementallyRead((bytes) => chunks.push([...bytes]), resolve, reject);
    });
    expect(chunks).toEqual([]);
    await completed;
    expect(chunks).toEqual([[1, 2]]);
    expect(fixture.networkingTasks()).toHaveLength(0);
  });
});

describe('Fetch body errors at the Promise binding boundary', () => {
  itPassesWith('explicitQueues').each([
    ['locked', 'full'], ['non-byte', 'full'], ['non-byte', 'incremental'], ['author', 'full'],
  ] as const)('delivers a %s failure through a borrowed %s read', (failure, method) => {
    const owner = createFetchWindow();
    const other = createFetchWindow();
    const runtime = owner.context.getRuntime();
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, runtime);
    const body = new BodyRecord(stream, runtime);
    const authorError = new other.realm.intrinsics.typeError('author failure');
    if (failure === 'locked') stream.getDefaultReader();
    else if (failure === 'non-byte') stream.enqueueChunk('not bytes');
    else stream.error(authorError);

    const bindings = new BindingWorld([bodyConsumerIDL]);
    const ownerBinding = bindings.register(owner.realm);
    bindings.register(other.realm).install(other.realm.global);
    const consumer = ownerBinding.project(
      BodyConsumerImpl, new BodyConsumerImpl(body, owner.realm.global, runtime),
    );
    const otherPrototype = (Reflect.get(other.realm.global, 'BodyConsumer') as typeof Object).prototype;
    const borrowed = Reflect.get(otherPrototype, method) as CallableFunction;
    const result = Reflect.apply(borrowed, consumer, []) as Promise<void>;
    expect(result).toBeInstanceOf(owner.realm.intrinsics.promise.constructor);
    const observed: unknown[] = [];
    const fulfilled = vi.fn();
    const record = owner.realm.createFunction(
      (_receiver, [reason]) => { observed.push(reason); }, { name: 'record', length: 1 },
    );
    Reflect.apply(owner.realm.intrinsics.promise.then, result, [fulfilled, record]);

    performTestMicrotaskCheckpoint(owner.realm.global);
    other.runTask();
    expect(observed).toEqual([]);
    owner.runTask();
    expect(fulfilled).not.toHaveBeenCalled();
    expect(observed).toHaveLength(1);
    if (failure === 'author') {
      expect(observed[0]).toBe(authorError);
    } else {
      expect(observed[0]).toBeInstanceOf(owner.realm.intrinsics.typeError);
      expect(observed[0]).not.toBeInstanceOf(other.realm.intrinsics.typeError);
    }
  });
});

// A test consumer covers real body algorithms and shared Promise projection
// while Request/Response's author-facing body consumption is still unfinished.
class BodyConsumerImpl {
  constructor(
    readonly body: BodyRecord,
    readonly destination: GlobalObject,
    readonly runtime: RuntimeContext,
  ) {}

  full(): PromiseValue<void> {
    const result = this.runtime.promises.withResolvers<void>();
    this.body.fullyRead(() => result.resolve(), result.reject, this.destination);
    return result.promise;
  }

  incremental(): PromiseValue<void> {
    const result = this.runtime.promises.withResolvers<void>();
    this.body.incrementallyRead(() => {}, result.resolve, result.reject, this.destination);
    return result.promise;
  }
}

// interface BodyConsumer { Promise<undefined> full(); Promise<undefined> incremental(); };
const bodyConsumerIDL = defineInterface({
  name: 'BodyConsumer', exposed: '*', implementation: impl(BodyConsumerImpl),
  members: [op('full', promise(idlType.undefined)), op('incremental', promise(idlType.undefined))],
});
