import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { codeUnitsToString, isomorphicDecode, isomorphicEncode } from '../../src/js-engine/byte-string';
import { InternalError } from '../../src/infra/internal-error';

describe('UTF-16 storage materialization', () => {
  it('reads foreign code-unit views with their byte offsets intact', () => {
    const units = runInNewContext('Uint16Array.of(0, 0x20ac, 0x61, 0).subarray(1, 3)') as Uint16Array;
    expect(codeUnitsToString(units)).toBe('€a');
  });
});

describe('Infra isomorphic byte/string conversion', () => {
  it('preserves all byte values, including C1 controls, across offset views', () => {
    const data = Uint8Array.from({ length: 259 }, (_, i) => i & 255);
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
    expect(() => isomorphicEncode(text)).toThrow(InternalError);
  });
});
