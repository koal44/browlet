import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { expectBytesEqual } from './bytes';

describe('byte assertions', () => {
  it('accepts equal contents and empty views', () => {
    expect(() => expectBytesEqual(Uint8Array.of(0, 128, 255), Uint8Array.of(0, 128, 255))).not.toThrow();
    expect(() => expectBytesEqual(Uint8Array.of(9).subarray(1), new Uint8Array())).not.toThrow();
  });

  it.each([
    { name: 'different bytes', actual: [1, 9, 3], expected: [1, 2, 3] },
    { name: 'missing bytes', actual: [1, 2], expected: [1, 2, 3] },
    { name: 'extra bytes', actual: [1, 2, 3], expected: [1, 2] },
  ])('rejects $name with a comparison failure', ({ actual, expected }) => {
    expect(() => expectBytesEqual(Uint8Array.from(actual), Uint8Array.from(expected))).toThrow(/deeply equal/);
  });

  it.each([false, true])('compares only the visible bytes of foreign storage (shared=%s)', (shared) => {
    const actual = runInNewContext(`new Uint8Array(new ${shared ? 'SharedArrayBuffer' : 'ArrayBuffer'}(8), 2, 3)`) as Uint8Array;
    actual.set([1, 2, 3]);
    const expected = Uint8Array.of(9, 1, 2, 3, 8).subarray(1, 4);
    expect(() => expectBytesEqual(actual, expected)).not.toThrow();
    actual[2] = 4;
    expect(() => expectBytesEqual(actual, expected)).toThrow(/deeply equal/);
  });
});
