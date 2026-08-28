import { describe, expect, it } from 'vitest';

import {
  forgivingBase64Decode, forgivingBase64Encode,
} from '../../../src/shared/base64';

describe('Infra section 7 forgiving base64', () => {
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %j', (input, expected) => {
    expect(forgivingBase64Encode(bytes(input))).toBe(expected);
  });

  it.each([
    ['', ''],
    ['Zg==', 'f'],
    ['Zm8=', 'fo'],
    ['Zm9v', 'foo'],
    ['Zm9vYg==', 'foob'],
    ['Zm9vYmE=', 'fooba'],
    ['Zm9vYmFy', 'foobar'],
  ])('decodes %j', (input, expected) => {
    expect(text(forgivingBase64Decode(input))).toBe(expected);
  });

  it('removes ASCII whitespace before decoding', () => {
    expect(text(forgivingBase64Decode('\t Zm\n9v\fYm\rFy ')))
      .toBe('foobar');
  });

  it('accepts omitted padding', () => {
    expect(text(forgivingBase64Decode('Zg'))).toBe('f');
    expect(text(forgivingBase64Decode('Zm8'))).toBe('fo');
  });

  it('discards unused trailing bits', () => {
    expect(text(forgivingBase64Decode('YQ'))).toBe('a');
    expect(text(forgivingBase64Decode('YR'))).toBe('a');
  });

  it.each([
    'A',
    'Zg=',
    'Zg===',
    'Zg-_',
    'Zm=v',
    'Zm9v\u00a0',
  ])('returns failure for %j', (input) => {
    expect(forgivingBase64Decode(input)).toBeNull();
  });
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function text(value: Uint8Array | null): string | null {
  return value === null ? null : decoder.decode(value);
}
