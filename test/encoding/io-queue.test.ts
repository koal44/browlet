import { setImmediate as nextTurn } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { endOfQueue, IOQueue } from '../../src/encoding/io-queue';
import { createRuntime } from '../js-engine/runtime-fixture';
import { TestRealm } from '../web-idl/test-realm';

describe('Encoding §3: I/O queues', () => {
  it('distinguishes empty open input from a persistent end marker', () => {
    const queue = new IOQueue<Uint8Array>();
    expect(queue.readAvailable()).toBeUndefined();
    expect(queue.peek(1)).toBeUndefined();
    queue.push(endOfQueue);
    expect(queue.readAvailable()).toBe(endOfQueue);
    expect(queue.readAvailable()).toBe(endOfQueue);
    expect(queue.peek(2)).toEqual([]);
    queue.push(Uint8Array.of(3, 4));
    queue.push(endOfQueue);
    expect(queue.peek(3)).toEqual([3, 4]);
    expect(queue.takeBytes()).toEqual(Uint8Array.of(3, 4));
    expect(queue.readAvailable()).toBe(endOfQueue);
  });

  it('peeks and restores across chunk boundaries without consuming or reordering', () => {
    const queue = new IOQueue<Uint8Array>();
    queue.push(Uint8Array.of(2, 3));
    queue.push(Uint8Array.of(4, 5));
    expect(queue.readAvailable()).toBe(2);
    expect(queue.peek(4)).toBeUndefined();
    queue.restore(Uint8Array.of(0, 1, 2));
    expect(queue.peek(6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(queue.takeBytes()).toEqual(Uint8Array.of(0, 1, 2, 3, 4, 5));
    queue.restore(Uint8Array.of(6));
    queue.push(Uint8Array.of(7));
    expect(queue.takeBytes()).toEqual(Uint8Array.of(6, 7));
  });

  it('counts strings as scalar values, including after a partial read', () => {
    const queue = IOQueue.from('a💩b');
    expect(queue.peek(2)).toEqual([0x61, 0x1f4a9]);
    expect(queue.readAvailable()).toBe(0x61);
    expect(queue.readAvailable()).toBe(0x1f4a9);
    queue.restore('😀');
    expect(queue.peek(4)).toEqual([0x1f600, 0x62]);
    expect(queue.takeString()).toBe('😀b');
    expect(queue.readAvailable()).toBe(endOfQueue);
  });

  it('reads a requested number of items across chunks, excluding the end marker', () => {
    const queue = new IOQueue<string>();
    queue.push('a💩');
    expect(queue.readAvailable(0)).toEqual([]);
    expect(queue.readAvailable(3)).toBeUndefined();
    expect(queue.peek(2)).toEqual([0x61, 0x1f4a9]);
    queue.push('bc');
    expect(queue.readAvailable(3)).toEqual([0x61, 0x1f4a9, 0x62]);
    queue.push(endOfQueue);
    expect(queue.readAvailable(3)).toEqual([0x63]);
    expect(queue.readAvailable(3)).toEqual([]);
    expect(queue.readAvailable()).toBe(endOfQueue);
  });

  it('collects a scalar list from the current position across chunks', () => {
    const queue: IOQueue<string> = IOQueue.from('a💩');
    queue.push('\0€');
    expect(queue.readAvailable()).toBe(0x61);
    expect(queue.takeList()).toEqual([0x1f4a9, 0, 0x20ac]);
    expect(queue.readAvailable()).toBe(endOfQueue);
  });

  it('joins large scalar chunks', () => {
    const queue = new IOQueue<string>();
    queue.push('prefix:');
    queue.push('€'.repeat(70000));
    queue.push('💩');
    queue.push('\0a');
    queue.push(endOfQueue);
    expect(queue.takeString()).toBe(`prefix:${'€'.repeat(70000)}💩\0a`);
    expect(queue.readAvailable()).toBe(endOfQueue);
  });

  it.each([false, true])('collects a partial single string and accepts more input (ended=%s)', (ended) => {
    const queue = new IOQueue<string>();
    expect(queue.takeString()).toBe('');
    queue.push('😀a');
    if (ended) queue.push(endOfQueue);
    expect(queue.readAvailable()).toBe(0x1f600);
    expect(queue.takeString()).toBe('a');
    expect(queue.takeString()).toBe('');
    expect(queue.readAvailable()).toBe(ended ? endOfQueue : undefined);
    queue.push('next');
    expect(queue.takeString()).toBe('next');
    expect(queue.readAvailable()).toBe(ended ? endOfQueue : undefined);
  });

  it.each([false, true])('collects unread bytes into independent storage (multiple chunks=%s)', (multiple) => {
    const source = Uint8Array.of(0, 1, 2, 3, 4);
    const queue = IOQueue.from(source.subarray(1, 4));
    expect(queue.readAvailable()).toBe(1);
    if (multiple) queue.push(source.subarray(4));
    const bytes = queue.takeBytes();
    expect([...bytes]).toEqual(multiple ? [2, 3, 4] : [2, 3]);
    expect(bytes.buffer).not.toBe(source.buffer);
    bytes[0] = 99;
    source[3] = 88;
    expect(source[2]).toBe(2);
    expect(bytes[1]).toBe(3);
    expect(queue.takeBytes()).toEqual(new Uint8Array());
    queue.push(Uint8Array.of(5));
    expect(queue.takeBytes()).toEqual(Uint8Array.of(5));
    expect(queue.readAvailable()).toBe(endOfQueue);
  });

  it('consumes byte chunks from another realm with their offsets intact', () => {
    const bytes = runInNewContext('Uint8Array.of(0, 0x80, 0x61, 0).subarray(1, 3)') as Uint8Array;
    expect(IOQueue.from(bytes).takeBytes()).toEqual(Uint8Array.of(0x80, 0x61));
  });

  it.each([0, 1, 3])('creates %s collected byte chunks in the supplied runtime', (count) => {
    const realm = new TestRealm();
    const queue = new IOQueue<Uint8Array>();
    const source = Uint8Array.of(0, 1, 2, 3, 4, 5);
    for (let i = 0; i < count; i++) queue.push(source.subarray(i * 2, i * 2 + 2));
    if (count) expect(queue.readAvailable()).toBe(0);
    queue.push(endOfQueue);
    const bytes = queue.takeBytes(createRuntime(realm));
    expect([...bytes]).toEqual([...source.subarray(count ? 1 : 0, count * 2)]);
    expect(Object.getPrototypeOf(bytes)).toBe(realm.evaluate('Uint8Array.prototype', 'queue-test.js'));
    expect(Object.getPrototypeOf(bytes.buffer)).toBe(realm.intrinsics.bufferSource.arrayBuffer.prototype);
    source.fill(99);
    if (count) expect(bytes[0]).toBe(1);
    expect(queue.readAvailable()).toBe(endOfQueue);
  });

  it('collects empty and single byte chunks without closing an open queue', () => {
    const queue = new IOQueue<Uint8Array>();
    expect(queue.takeBytes()).toEqual(new Uint8Array());
    expect(queue.readAvailable()).toBeUndefined();
    queue.push(Uint8Array.of(1, 2));
    expect(queue.readAvailable()).toBe(1);
    expect(queue.takeBytes()).toEqual(Uint8Array.of(2));
    expect(queue.readAvailable()).toBeUndefined();
    queue.restore(Uint8Array.of(3));
    expect(queue.takeBytes()).toEqual(Uint8Array.of(3));
  });

  it('waits for enough input, or for end of input, without consuming it', async () => {
    const queue = new IOQueue<string>();
    const runtime = createRuntime();
    const events: unknown[] = [];
    queue.waitFor(2, runtime).observe(() => { events.push('two'); }, (error) => { events.push(error); });
    queue.waitFor(4, runtime).observe(() => { events.push('four'); }, (error) => { events.push(error); });
    queue.push('');
    queue.push('💩');
    await nextTurn();
    expect(events).toEqual([]);
    queue.push('a');
    await nextTurn();
    expect(events).toEqual(['two']);
    expect(queue.peek(2)).toEqual([0x1f4a9, 0x61]);
    queue.push(endOfQueue);
    await nextTurn();
    expect(events).toEqual(['two', 'four']);
    expect(queue.takeString()).toBe('💩a');
  });

  it('counts remaining and restored bytes when waking readers', async () => {
    const queue = new IOQueue<Uint8Array>();
    const runtime = createRuntime();
    const events: unknown[] = [];
    queue.waitFor(0, runtime).observe(() => { events.push('zero'); }, (error) => { events.push(error); });
    queue.push(Uint8Array.of(1, 2, 3));
    expect(queue.readAvailable(2)).toEqual([1, 2]);
    queue.waitFor(3, runtime).observe(() => { events.push('three'); }, (error) => { events.push(error); });
    queue.waitFor(4, runtime).observe(() => { events.push('four'); }, (error) => { events.push(error); });
    queue.restore(Uint8Array.of(0));
    await nextTurn();
    expect(events).toEqual(['zero']);
    queue.push(Uint8Array.of(4));
    await nextTurn();
    expect(events).toEqual(['zero', 'three']);
    expect(queue.peek(3)).toEqual([0, 3, 4]);
    queue.push(endOfQueue);
    await nextTurn();
    expect(events).toEqual(['zero', 'three', 'four']);
    expect(queue.takeBytes()).toEqual(Uint8Array.of(0, 3, 4));
  });

  it('preserves waiting readers across partial wakes and later suspension', async () => {
    const queue = new IOQueue<Uint8Array>();
    const runtime = createRuntime();
    const events: unknown[] = [];
    for (const count of [3, 1, 2, 1]) {
      queue.waitFor(count, runtime).observe(() => { events.push(count); }, (error) => { events.push(error); });
    }
    queue.push(Uint8Array.of(1));
    await nextTurn();
    expect(events).toEqual([1, 1]);
    queue.push(Uint8Array.of(2));
    await nextTurn();
    expect(events).toEqual([1, 1, 2]);
    queue.push(Uint8Array.of(3));
    await nextTurn();
    expect(events).toEqual([1, 1, 2, 3]);
    expect(queue.takeBytes()).toEqual(Uint8Array.of(1, 2, 3));

    queue.waitFor(2, runtime).observe(() => { events.push('later'); }, (error) => { events.push(error); });
    queue.restore(Uint8Array.of(4));
    await nextTurn();
    expect(events).toEqual([1, 1, 2, 3]);
    queue.push(endOfQueue);
    await nextTurn();
    expect(events).toEqual([1, 1, 2, 3, 'later']);
    expect(queue.takeBytes()).toEqual(Uint8Array.of(4));
  });
});
