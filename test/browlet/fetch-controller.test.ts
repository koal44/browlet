import { describe, expect, it } from 'vitest';
import { createFetchWindow, createIsolatedFetchRealm } from './fetch-fixture';

describe('Fetch controller abort reasons through HTML structured data', () => {
  it('serializes the default DOMException and restores it in another realm', () => {
    const source = createFetchWindow();
    const target = createFetchWindow();
    source.abort();
    expect(source.controller.serializedAbortReason).not.toBeNull();
    const restored = target.deserialize(source.controller.serializedAbortReason);
    expectAbortError(restored, target);
  });

  it.each([null, false, 0, ''])('preserves the explicit abort reason %j', (reason) => {
    const source = createFetchWindow();
    const target = createFetchWindow();
    source.abort(reason);
    expect(target.deserialize(source.controller.serializedAbortReason)).toBe(reason);
  });

  it('uses AbortError for a missing record and for serialized undefined', () => {
    const target = createFetchWindow();
    for (const record of [null, target.env.exec.serialize(undefined)]) {
      expectAbortError(target.deserialize(record), target);
    }
  });

  it('snapshots a cyclic reason at abort and recreates it in the target realm', () => {
    const source = createFetchWindow();
    const target = createFetchWindow();
    const window = source.realm.global as typeof globalThis;
    const reason = Object.assign(new window.Object(), {
      value: new window.Array('original'),
    }) as { value: string[]; self: unknown; };
    reason.self = reason;
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
    { name: 'a symbol', create: (window: typeof globalThis) => window.Symbol('uncloneable') },
    { name: 'a function', create: (window: typeof globalThis) => window.Object },
    {
      name: 'an object with a throwing getter',
      create: (window: typeof globalThis) => Object.defineProperty(new window.Object(), 'value', {
        enumerable: true,
        get() { throw new window.Error('getter'); },
      }),
    },
  ])('serializes an AbortError fallback when the reason is $name', ({ create }) => {
    const source = createFetchWindow();
    const target = createFetchWindow();
    source.abort(create(source.realm.global as typeof globalThis));

    const restored = target.deserialize(source.controller.serializedAbortReason);
    expectAbortError(restored, target);
    expect(source.controller.state).toBe('aborted');
  });

  it('falls back when HTML cannot deserialize a buffer into a different agent cluster', () => {
    const source = createIsolatedFetchRealm();
    const target = createFetchWindow();
    // StructuredSerialize allows shared data; StructuredSerializeForStorage does not.
    const SharedBuffer = source.realm.intrinsics.bufferSource.sharedArrayBuffer!;
    source.abort(new SharedBuffer(4));
    expect(source.controller.serializedAbortReason).toMatchObject({ type: 'SharedArrayBuffer' });

    expectAbortError(target.deserialize(source.controller.serializedAbortReason), target);
  });
});

describe('RealmExecution structured serialization', () => {
  it('reuses a snapshot to reconstruct independent graphs in destination realms', () => {
    const source = createFetchWindow();
    const target = createFetchWindow();
    const other = createFetchWindow();
    type Value = { bytes: Uint8Array; alias: Uint8Array; self: Value; };
    const window = source.realm.global as typeof globalThis;
    const bytes = new window.Uint8Array([1, 2]);
    const value = Object.assign(new window.Object(), { bytes, alias: bytes }) as Value;
    value.self = value;
    const record = source.env.exec.serialize(value);
    value.bytes[0] = 9;

    const first = target.env.exec.deserialize(record) as Value;
    const second = other.env.exec.deserialize(record) as Value;
    for (const [restored, destination] of [[first, target], [second, other]] as const) {
      expect([...restored.bytes]).toEqual([1, 2]);
      expect(restored.self).toBe(restored);
      expect(restored.alias).toBe(restored.bytes);
      expect(Object.getPrototypeOf(restored)).toBe(destination.realm.intrinsics.object.prototype);
      const destinationWindow = destination.realm.global as typeof globalThis;
      expect(Object.getPrototypeOf(restored.bytes)).toBe(destinationWindow.Uint8Array.prototype);
      expect(Object.getPrototypeOf(restored.bytes.buffer)).toBe(destinationWindow.ArrayBuffer.prototype);
    }
    first.bytes[0] = 7;
    expect([...second.bytes]).toEqual([1, 2]);
    expect([...value.bytes]).toEqual([9, 2]);
  });
});

describe('Fetch tasks on HTML event loops', () => {
  it('runs networking tasks in order on their destination event loops', () => {
    const first = createFetchWindow();
    const second = createFetchWindow();
    const order: string[] = [];

    first.queueTask(() => order.push('first'));
    second.queueTask(() => order.push('second'));
    first.queueTask(() => order.push('third'));

    expect(order).toEqual([]);

    first.runTask();
    expect(order).toEqual(['first']);
    first.runTask();
    expect(order).toEqual(['first', 'third']);
    second.runTask();
    expect(order).toEqual(['first', 'third', 'second']);
  });
});

function expectAbortError(reason: unknown, target: ReturnType<typeof createFetchWindow>) {
  expect(reason).toMatchObject({ name: 'AbortError', message: '', code: 20 });
  expect(Object.getPrototypeOf(reason)).toBe((target.realm.global as typeof globalThis).DOMException.prototype);
}
