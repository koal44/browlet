import { describe, expect, it } from 'vitest';

import { createFetchWindow, createIsolatedFetchRealm } from '../fetch-fixture';

describe('Fetch controller abort reasons through HTML structured data', () => {
  it('snapshots a cyclic reason at abort and recreates it in the target realm', () => {
    const source = createFetchWindow();
    const target = createFetchWindow();
    const reason = source.realm.evaluate(`(() => {
      const reason = { value: ['original'] };
      reason.self = reason;
      return reason;
    })()`, 'fetch-abort.js') as { value: string[]; self: unknown; };
    source.abort(reason);
    reason.value.push('later');
    const restored = target.deserialize(source.controller.serializedAbortReason) as typeof reason;

    expect(restored.value).toEqual(['original']);
    expect(restored.self).toBe(restored);
    expect(restored).not.toBe(reason);
    expect(Object.getPrototypeOf(restored)).toBe(target.realm.intrinsics.object.prototype);
    expect(Object.getPrototypeOf(restored.value)).toBe(target.realm.intrinsics.array.prototype);
  });

  it.each([
    'Symbol("uncloneable")',
    '() => {}',
    '({ get value() { throw new Error("getter"); } })',
  ])('serializes an AbortError fallback when the reason is %s', (sourceText) => {
    const source = createFetchWindow();
    const target = createFetchWindow();
    source.abort(source.realm.evaluate(sourceText, 'uncloneable-abort.js'));

    const restored = target.deserialize(source.controller.serializedAbortReason);
    expectAbortError(restored, target);
    expect(source.controller.state).toBe('aborted');
  });

  it('serializes the default DOMException and restores it in another realm', () => {
    const source = createFetchWindow();
    const target = createFetchWindow();
    source.abort();
    expect(source.controller.serializedAbortReason).not.toBeNull();
    const restored = target.deserialize(source.controller.serializedAbortReason);
    expectAbortError(restored, target);
  });

  it('uses AbortError for a missing record and for serialized undefined', () => {
    const target = createFetchWindow();
    for (const record of [null, target.structuredData.serialize(undefined)]) {
      expectAbortError(target.deserialize(record), target);
    }
  });

  it.each([null, false, 0, ''])('preserves the explicit abort reason %j', (reason) => {
    const source = createFetchWindow();
    const target = createFetchWindow();
    source.abort(reason);
    expect(target.deserialize(source.controller.serializedAbortReason)).toBe(reason);
  });

  it('falls back when HTML cannot deserialize a buffer into a different agent cluster', () => {
    const source = createIsolatedFetchRealm();
    const target = createFetchWindow();
    // StructuredSerialize allows shared data; StructuredSerializeForStorage does not.
    source.abort(source.realm.evaluate('new SharedArrayBuffer(4)', 'shared-abort.js'));
    expect(source.controller.serializedAbortReason).toMatchObject({ type: 'SharedArrayBuffer' });

    expectAbortError(target.deserialize(source.controller.serializedAbortReason), target);
  });
});

describe('Fetch tasks on HTML event loops', () => {
  it('queues networking tasks for the destination Window and its Document', () => {
    const first = createFetchWindow();
    const second = createFetchWindow();
    const order: string[] = [];
    const steps = () => order.push('first');

    first.queueTask(steps);
    second.queueTask(() => order.push('second'));
    first.queueTask(() => order.push('third'));

    const tasks = first.networkingTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.steps).toBe(steps);
    expect(tasks.every((task) => task.document === first.document)).toBe(true);
    expect(second.networkingTasks()).toHaveLength(1);
    expect(order).toEqual([]);

    first.runTask();
    first.runTask();
    expect(order).toEqual(['first', 'third']);
    second.runTask();
    expect(order).toEqual(['first', 'third', 'second']);
  });
});

function expectAbortError(reason: unknown, target: ReturnType<typeof createFetchWindow>) {
  expect(reason).toMatchObject({ name: 'AbortError', message: '', code: 20 });
  expect(Object.getPrototypeOf(reason)).toBe(
    target.realm.evaluate('DOMException.prototype', 'fetch-abort-prototype.js'),
  );
}
