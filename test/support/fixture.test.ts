import { describe, expect, it } from 'vitest';
import { Fixture, useFixture } from './fixture';

describe('fixture lifetime', () => {
  it('stops a timed-out continuation while its underlying operation completes', async () => {
    const timeout = new AbortController();
    const fixture = new Fixture(timeout.signal);
    const operation = Promise.withResolvers<void>();
    const continued: string[] = [];
    const waiting = fixture.waitFor(operation.promise).then(() => { continued.push('late'); });
    const reason = new Error('test deadline');
    const rejected = expect(waiting).rejects.toBe(reason);
    timeout.abort(reason);
    await rejected;
    operation.resolve();
    await fixture.dispose();
    expect(continued).toEqual([]);
  });

  it('finishes all cleanup before reporting failures, and disposes only once', async () => {
    const fixture = new Fixture();
    const released = Promise.withResolvers<void>();
    const order: string[] = [];
    const error = new Error('resource cleanup');
    fixture.onCleanup(() => { order.push('first resource'); });
    fixture.onCleanup(() => { order.push('failed resource'); throw error; });
    fixture.onCleanup(async () => { await released.promise; order.push('last resource'); });
    const disposal = fixture.dispose();
    const rejected = expect(disposal).rejects.toMatchObject({ errors: [error] });
    expect(fixture.dispose()).toBe(disposal);
    expect(order).toEqual([]);
    released.resolve();
    await rejected;
    expect(order).toEqual(['last resource', 'failed resource', 'first resource']);
  });

  it('cancels pending waits before cleanup releases their operation', async () => {
    const fixture = new Fixture();
    const operation = Promise.withResolvers<number>();
    fixture.onCleanup(() => { operation.resolve(42); });
    const rejected = expect(fixture.waitFor(operation.promise)).rejects.toThrow('Fixture disposed');
    await fixture.dispose();
    await rejected;
    expect(() => fixture.onCleanup(() => {})).toThrow('Fixture disposed');
  });
});

describe('fixture hooks', () => {
  let created = 0, released = 0;
  const fixture = useFixture((lifetime) => {
    expect(released).toBe(created);
    created++;
    lifetime.onCleanup(() => { released++; });
    return { values: [] as number[] };
  });
  it.each([1, 2])('provides fresh mutable state for case %s', (value) => {
    expect(fixture().values).toEqual([]);
    fixture().values.push(value);
  });
});
