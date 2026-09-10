import { afterEach, describe, expect, vi } from 'vitest';
import { itPassesWith } from '../../test-runtime';
import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import * as scheduling from '../../../src/browlet/integration/scripting';

afterEach(() => { vi.restoreAllMocks(); });

describe('writer monitoring Promise lifecycle', () => {
  itPassesWith('explicitQueues').each(['pending', 'writable', 'closed', 'errored'] as const)(
    'preserves or replaces public promises on release from %s', (state) => {
      vi.spyOn(scheduling, 'requestNodeEventLoopTurn').mockImplementation(() => {});
      const owner = createWriter(state === 'pending' ? 0 : 1);
      const foreign = createWriter();
      const failure = new foreign.realm.intrinsics.typeError('sink failed');
      if (state === 'closed') observe(owner, owner.writer.close());
      if (state === 'errored') owner.controller.error(failure);
      owner.realm.agent.eventLoop.performMicrotaskCheckpoint();

      const before = ['ready', 'closed'].map((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(foreign.writer), name,
        )!;
        const promise = Reflect.get(owner.writer, name) as Promise<void>;
        expect(descriptor.get!.call(owner.writer)).toBe(promise);
        expect(Reflect.get(owner.writer, name)).toBe(promise);
        const pending = state === 'pending' || (state === 'writable' && name === 'closed');
        const previous = pending ? [] : state === 'errored'
          ? [{ status: 'rejected', value: failure }]
          : [{ status: 'fulfilled', value: undefined }];
        return { name, descriptor, promise, pending, previous, trace: observe(owner, promise) };
      });
      foreign.realm.agent.eventLoop.performMicrotaskCheckpoint();
      expect(before.map(({ trace }) => trace)).toEqual([[], []]);
      owner.realm.agent.eventLoop.performMicrotaskCheckpoint();
      for (const { trace, previous } of before) expect(trace).toEqual(previous);

      owner.writer.releaseLock();
      const after = before.map(({ name, descriptor, promise, pending }) => {
        const current = Reflect.get(owner.writer, name) as Promise<void>;
        if (pending) expect(current).toBe(promise);
        else expect(current).not.toBe(promise);
        expect(Reflect.get(owner.writer, name)).toBe(current);
        expect(descriptor.get!.call(owner.writer)).toBe(current);
        return observe(owner, current);
      });
      foreign.realm.agent.eventLoop.performMicrotaskCheckpoint();
      expect(after).toEqual([[], []]);
      owner.realm.agent.eventLoop.performMicrotaskCheckpoint();
      const releasedError = after[0]![0]!.value;
      expect(releasedError).toBeInstanceOf(owner.realm.intrinsics.typeError);
      expect(releasedError).not.toBeInstanceOf(foreign.realm.intrinsics.typeError);
      for (const trace of after) {
        expect(trace).toEqual([{ status: 'rejected', value: releasedError }]);
      }
      for (const { trace, pending, previous } of before) {
        expect(trace).toEqual(pending ? after[0] : previous);
      }
    },
  );
});

function createWriter(highWaterMark = 1) {
  const { window } = new Browlet({ route: () => '' });
  const realm = getRelevantRealm(window);
  const WritableStream_ = Reflect.get(window, 'WritableStream') as typeof WritableStream;
  let controller!: WritableStreamDefaultController;
  const stream = new WritableStream_({
    start(value: WritableStreamDefaultController) { controller = value; },
  }, { highWaterMark });
  return { realm, controller, writer: stream.getWriter() };
}

function observe(owner: ReturnType<typeof createWriter>, promise: Promise<void>) {
  expect(promise).toBeInstanceOf(owner.realm.intrinsics.promise.constructor);
  const trace: { status: string; value: unknown; }[] = [];
  const record = (status: string) => owner.realm.createFunction((_receiver, [value]) => {
    trace.push({ status, value });
  }, { name: '', length: 1 });
  Reflect.apply(owner.realm.intrinsics.promise.then, promise, [
    record('fulfilled'), record('rejected'),
  ]);
  return trace;
}
