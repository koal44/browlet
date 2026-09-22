import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { itPassesWith } from '../test-runtime';
import { FetchBody } from '../../src/fetch/body';
import { RequestImpl } from '../../src/fetch/request';
import { FetchResponse, ResponseImpl } from '../../src/fetch/response';
import type { GlobalObject, RealmExecution } from '../../src/js-engine/index';
import type { PromiseValue } from '../../src/infra/promises';
import {
  defineInterface, idlType, impl, op, promise, BindingWorld,
} from '../../src/web-idl/index';
import { createFetchWindow } from './fetch-fixture';
import { performTestMicrotaskCheckpoint, observeBrowletPromise } from './test-runtime';
import { ReadableStreamImpl } from '../../src/streams/index';
import { Browlet } from '../../src/browlet/browlet';
import { getRelevantRealm } from '../../src/browlet/bindings';
import { queueGlobalFetchTask } from '../../src/browlet/integration/fetch';
import { networkingTaskSource } from '../../src/browlet/scripting/tasks';
import { createFetchRequest, fetchDefinitions } from '../fetch/fetch-fixture';

describe('Fetch body delivery through HTML', () => {
  it('delivers extracted bytes inside the owning HTML task', () => {
    const fixture = createFetchWindow();
    const loop = fixture.realm.agent.eventLoop;
    const body = FetchBody.fromBytes(Uint8Array.of(1, 2), fixture.context.getExecution());
    const chunk = vi.fn();
    body.stream.getDefaultReader().readChunk({
      chunkSteps: (value) => { chunk([...value as Uint8Array], loop.currentlyRunningTask); },
      closeSteps: vi.fn(),
      errorSteps: vi.fn(),
    });

    expect(chunk).not.toHaveBeenCalled();
    const [task] = fixture.networkingTasks();
    expect(task!.document).toBe(fixture.document);
    fixture.runTask();
    expect(chunk).toHaveBeenCalledExactlyOnceWith([1, 2], task);
  });

  it('routes a foreign body to the destination Window networking tasks', () => {
    const source = createFetchWindow();
    const target = createFetchWindow();
    const body = FetchBody.fromBytes(Uint8Array.of(1, 2), source.context.getExecution());
    const events: (number[] | string)[] = [];
    const error = vi.fn();
    body.incrementallyRead(
      (bytes) => events.push([...bytes]), () => events.push('end'), error,
      target.realm.global,
    );
    expect(events).toEqual([]);
    expect(source.networkingTasks()).toHaveLength(1);
    source.runTask();
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

  it('fully reads on the stream realm checkpoint and queues completion as another task', () => {
    const fixture = createFetchWindow();
    const body = FetchBody.fromBytes(Uint8Array.of(1, 2), fixture.context.getExecution());
    fixture.runTask();
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
    const body = FetchBody.fromBytes(Uint8Array.of(1, 2), fixture.context.getExecution());
    const chunks: number[][] = [];
    const completed = new Promise<void>((resolve, reject) => {
      body.incrementallyRead((bytes) => chunks.push([...bytes]), resolve, reject);
    });
    expect(chunks).toEqual([]);
    fixture.runTask();
    await completed;
    expect(chunks).toEqual([[1, 2]]);
    expect(fixture.networkingTasks()).toHaveLength(0);
  });

  it.each(['Request', 'Response'])('delivers borrowed %s consumption to the receiver Window even when the body stream belongs elsewhere', async (kind) => {
    const owner = createFetchWindow();
    const source = createFetchWindow();
    const bindings = new BindingWorld(fetchDefinitions);
    const ownerBinding = bindings.register(owner.realm, () => owner.context.getExecution());
    const otherBinding = bindings.register(source.realm, () => source.context.getExecution());
    const create = (context: typeof ownerBinding, body: FetchBody | null) => {
      if (kind === 'Request') {
        const request = createFetchRequest();
        request.body = body;
        return context.project(RequestImpl, context.construct(
          RequestImpl, request, 'request', context.getExecution().createDependentAbortSignal([]),
        ));
      }
      const response = new FetchResponse();
      response.body = body;
      return context.project(ResponseImpl, context.construct(ResponseImpl, response, 'response'));
    };
    const body = FetchBody.fromBytes(Uint8Array.of(65, 66), source.context.getExecution());
    const receiver = create(ownerBinding, body);
    const foreign = create(otherBinding, null);
    const text = Reflect.get(foreign, 'text') as () => Promise<string>;
    source.runTask();
    let result: Promise<string> | undefined;
    owner.queueTask(() => { result = Reflect.apply(text, receiver, []); });
    owner.runTask();
    expect(result).toBeInstanceOf(owner.realm.intrinsics.promise.constructor);
    const completion = observeBrowletPromise(owner.realm.global, result!);
    // The foreign stream's reads complete in its own queue before scheduling
    // the receiver's networking task. Stock Node drains its ambient queue here.
    await nextTurn();
    performTestMicrotaskCheckpoint(source.realm.global);
    expect(source.networkingTasks()).toHaveLength(0);
    expect(owner.networkingTasks()).toHaveLength(1);
    expect(owner.networkingTasks()[0]!.document).toBe(owner.document);
    owner.runTask();
    expect(await completion).toBe('AB');
  });
});

describe('Fetch body errors at the Promise binding boundary', () => {
  itPassesWith('explicitQueues').each([
    ['locked', 'full'], ['non-byte', 'full'], ['non-byte', 'incremental'], ['author', 'full'],
  ] as const)('delivers a %s failure through a borrowed %s read', (failure, method) => {
    const owner = createFetchWindow();
    const other = createFetchWindow();
    const exec = owner.context.getExecution();
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, exec);
    const body = new FetchBody(stream, exec);
    const authorError = new other.realm.intrinsics.typeError('author failure');
    if (failure === 'locked') stream.getDefaultReader();
    else if (failure === 'non-byte') stream.enqueueChunk('not bytes');
    else stream.error(authorError);

    const bindings = new BindingWorld([bodyConsumerIDL]);
    const ownerBinding = bindings.register(owner.realm);
    bindings.register(other.realm).install(other.realm.global);
    const consumer = ownerBinding.project(
      BodyConsumerImpl, new BodyConsumerImpl(body, owner.realm.global, exec),
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

// A test consumer exposes both full and incremental reads through Promise projection.
class BodyConsumerImpl {
  constructor(
    public body: FetchBody,
    public destination: GlobalObject,
    public exec: RealmExecution,
  ) {}

  full(): PromiseValue<void> {
    const result = this.exec.promises.withResolvers<void>();
    this.body.fullyRead(() => result.resolve(), result.reject, this.destination);
    return result.promise;
  }

  incremental(): PromiseValue<void> {
    const result = this.exec.promises.withResolvers<void>();
    this.body.incrementallyRead(() => {}, result.resolve, result.reject, this.destination);
    return result.promise;
  }
}

// interface BodyConsumer { Promise<undefined> full(); Promise<undefined> incremental(); };
const bodyConsumerIDL = defineInterface({
  name: 'BodyConsumer', exposed: '*', implementation: impl(BodyConsumerImpl),
  members: [op('full', promise(idlType.undefined)), op('incremental', promise(idlType.undefined))],
});
