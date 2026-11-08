import { describe, expect, it } from 'vitest';

import { ByteCursor, InputBoundary } from '../../src/infra/byte-cursor';

describe('incremental byte cursor', () => {
  it('distinguishes an open empty input from final EOF and every byte value', () => {
    const input = new ByteCursor();
    expect(input.peek()).toBe(InputBoundary.Waiting);
    input.appendData(new Uint8Array(0));
    expect(input.peek()).toBe(InputBoundary.Waiting);
    input.appendData(Uint8Array.of(0, 255));
    expect(input.peek()).toBe(0);
    expect(input.peek(1)).toBe(255);
    expect(input.peek(2)).toBe(InputBoundary.Waiting);
    input.finish();
    expect(input.peek()).toBe(0);
    expect(input.peek(2)).toBe(InputBoundary.End);
    input.advance(2);
    expect(input.peek()).toBe(InputBoundary.End);
    input.finish();
    expect(input.peek()).toBe(InputBoundary.End);
  });

  it('retains original views and their offsets for bulk scanning and delivery', () => {
    const storage = Uint8Array.of(99, 10, 20, 30, 88);
    const chunk = storage.subarray(1, 4);
    const input = new ByteCursor();
    input.appendData(chunk);
    expect(input.chunk).toBe(chunk);
    input.advance();
    expect(input.position).toBe(1);
    expect(input.chunk).toBe(chunk);
    const delivered = input.chunk.subarray(input.position);
    input.advance(2);
    expect(input.chunk.length).toBe(0);
    expect(input.position).toBe(0);
    expect(delivered.buffer).toBe(storage.buffer);
    expect(delivered.byteOffset).toBe(storage.byteOffset + 2);
    expect([...delivered]).toEqual([20, 30]);
  });

  it('appends behind unread input and peeks across chunks without advancing', () => {
    const input = new ByteCursor();
    const first = Uint8Array.of(1, 2, 3);
    const second = Uint8Array.of(4, 5);
    const third = Uint8Array.of(6);
    input.appendData(first);
    input.advance();
    input.appendData(second);
    input.appendData(new Uint8Array(0));
    input.appendData(third);
    expect(Array.from({ length: 5 }, (_, i) => input.peek(i))).toEqual([2, 3, 4, 5, 6]);
    expect(input.peek(5)).toBe(InputBoundary.Waiting);
    expect(input.chunk).toBe(first);
    expect(input.position).toBe(1);
    input.finish();
    input.advance(2);
    expect(input.chunk).toBe(second);
    expect(input.position).toBe(0);
    input.advance(2);
    expect(input.chunk).toBe(third);
    input.advance();
    expect(input.peek()).toBe(InputBoundary.End);
  });

  it('allows new input after draining both direct and queued chunks', () => {
    const input = new ByteCursor();
    for (let round = 0; round < 3; round++) {
      input.appendData(Uint8Array.of(1));
      input.appendData(Uint8Array.of(2));
      input.advance();
      expect(input.peek()).toBe(2);
      input.advance();
      expect(input.peek()).toBe(InputBoundary.Waiting);
    }
  });

  it('releases unread storage without reopening finished input', () => {
    const input = new ByteCursor();
    input.appendData(Uint8Array.of(1, 2));
    input.advance();
    input.appendData(Uint8Array.of(3));
    input.clear();
    expect(input.chunk.length).toBe(0);
    expect(input.position).toBe(0);
    expect(input.peek()).toBe(InputBoundary.Waiting);
    input.appendData(Uint8Array.of(4));
    input.finish();
    input.clear();
    expect(input.peek()).toBe(InputBoundary.End);
    expect(() => input.appendData(Uint8Array.of(5))).toThrow('after finishing');
    expect(() => input.appendData(new Uint8Array(0))).toThrow('after finishing');
  });

  it('rejects invalid movement without changing position or queued input', () => {
    const input = new ByteCursor();
    input.appendData(Uint8Array.of(1, 2));
    input.appendData(Uint8Array.of(3, 4));
    for (const count of [-1, 0.5, 3, NaN, Infinity]) {
      expect(() => input.advance(count)).toThrow('Advance exceeds');
      expect(input.position).toBe(0);
      expect(input.peek(2)).toBe(3);
    }
    for (const offset of [-1, 0.5, NaN, Infinity]) expect(() => input.peek(offset)).toThrow('Invalid byte lookahead');
    input.advance(0);
    expect(input.peek()).toBe(1);
  });
});
