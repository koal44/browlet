import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { runInNewContext } from 'node:vm';
import { codeUnitsToString, isomorphicDecode, isomorphicEncode, writeUTF8Into } from '../../src/js-engine/byte-string';

describe('UTF-8 destination writing', () => {
  it.each(['\u00e9', '\u0400', '\u07ff'])('fills destinations from two-byte character %j', (character) => {
    for (const length of [32, 33, 258]) {
      const source = character.repeat(length);
      for (const capacity of [0, 1, 2, 3, 4, length * 2]) {
        const destination = new Uint8Array(capacity).fill(0xaa);
        const read = Math.min(length, Math.floor(capacity / 2));
        const expected = Buffer.from(source.slice(0, read));
        expect(writeUTF8Into(source, destination)).toEqual({ read, written: expected.length });
        expect(destination.subarray(0, expected.length)).toEqual(new Uint8Array(expected));
        expect(destination.subarray(expected.length).every((byte) => byte === 0xaa)).toBe(true);
      }
    }
  });

  it.each([false, true])('respects foreign destination offsets (shared=%s)', (shared) => {
    const destination = runInNewContext(`new Uint8Array(new ${shared ? 'SharedArrayBuffer' : 'ArrayBuffer'}(8), 2, 4)`) as Uint8Array;
    const storage = new Uint8Array(destination.buffer).fill(0xaa);
    expect(writeUTF8Into('é'.repeat(33), destination)).toEqual({ read: 2, written: 4 });
    expect(Array.from(storage)).toEqual([0xaa, 0xaa, 0xc3, 0xa9, 0xc3, 0xa9, 0xaa, 0xaa]);
  });

  it('counts consumed code units without splitting characters, replacing unpaired surrogates', () => {
    const source = 'Aé😀\ud800Z';
    const characters = Array.from(source.toWellFormed());
    for (let capacity = 0; capacity <= 12; capacity++) {
      let read = 0;
      let written = 0;
      for (const character of characters) {
        const size = Buffer.byteLength(character);
        if (written + size > capacity) break;
        read += character.length;
        written += size;
      }
      const destination = new Uint8Array(capacity).fill(0xaa);
      expect(writeUTF8Into(source, destination)).toEqual({ read, written });
      expect(destination.subarray(0, written)).toEqual(new Uint8Array(Buffer.from(source.slice(0, read))));
      expect(destination.subarray(written).every((byte) => byte === 0xaa)).toBe(true);
    }
  });
});

describe('UTF-16 storage materialization', () => {
  it('reads foreign code-unit views with their byte offsets intact', () => {
    const units = runInNewContext('Uint16Array.of(0, 0x20ac, 0x61, 0).subarray(1, 3)') as Uint16Array;
    expect(codeUnitsToString(units)).toBe('€a');
  });
});

describe('Infra isomorphic byte/string conversion', () => {
  it('preserves all byte values, including C1 controls, across large offset views', () => {
    const data = Uint8Array.from({ length: 65539 }, (_, i) => i & 255);
    const input = data.subarray(1, -2);
    const expected = Array.from(input, (byte) => String.fromCharCode(byte)).join('');
    expect(isomorphicDecode(input)).toBe(expected);
    const bytes = isomorphicEncode(expected);
    expect(bytes).toEqual(input);
    bytes.fill(0);
    expect(input[0]).toBe(1);
  });

  it('handles empty values', () => {
    expect(isomorphicDecode(new Uint8Array())).toBe('');
    expect(isomorphicEncode('')).toEqual(new Uint8Array());
  });

  it.each(['\u0100', '😀', '\ud800'])('rejects non-isomorphic input %j instead of truncating it', (text) => {
    expect(() => isomorphicEncode(text)).toThrow(TypeError);
  });
});
