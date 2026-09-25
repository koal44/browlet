import { describe, expect, it } from 'vitest';

import { parseContentRange } from '../../src/http/content-range';

describe('Content-Range (RFC 9110 §14.4)', () => {
  it.each([
    ['bytes 0-499/1234', { first: 0n, last: 499n, completeLength: 1234n }],
    ['bytes 500-999/1234', { first: 500n, last: 999n, completeLength: 1234n }],
    ['bytes 500-1233/1234', { first: 500n, last: 1233n, completeLength: 1234n }],
    ['bytes 734-1233/1234', { first: 734n, last: 1233n, completeLength: 1234n }],
    ['bytes 42-1233/*', { first: 42n, last: 1233n }],
    ['bytes 0-0/1', { first: 0n, last: 0n, completeLength: 1n }],
    ['bytes 0-0/*', { first: 0n, last: 0n }],
    ['\t ByTeS 000-009/0010 \t', { first: 0n, last: 9n, completeLength: 10n }],
  ])('parses inclusive offsets in %s', (input, expected) => {
    expect(parseContentRange(input)).toStrictEqual(expected);
  });

  it('parses unsatisfied ranges, including an empty representation', () => {
    expect(parseContentRange('bytes */1234')).toStrictEqual({ completeLength: 1234n });
    expect(parseContentRange('bytes */0')).toStrictEqual({ completeLength: 0n });
  });

  it('preserves values beyond safe integer and 64-bit limits without rounding', () => {
    expect(parseContentRange('bytes 9007199254740992-9007199254740993/9007199254740994'))
      .toEqual({ first: 9007199254740992n, last: 9007199254740993n, completeLength: 9007199254740994n });
    const total = 10n ** 100n;
    expect(parseContentRange(`bytes 0-${total - 1n}/${total}`))
      .toEqual({ first: 0n, last: total - 1n, completeLength: total });
    expect(parseContentRange(`bytes */${total}`))
      .toStrictEqual({ completeLength: total });
  });

  it.each([
    'bytes 9-8/10', 'bytes 0-10/10', 'bytes 0-10/9', 'bytes 0-0/0',
    'bytes 9007199254740993-9007199254740992/*',
    'bytes 0-9007199254740993/9007199254740993',
  ])('rejects invalid bounds in %s', (input) => {
    expect(parseContentRange(input)).toBeNull();
  });

  it.each([
    '', 'bytes', 'bytes */*', 'bytes -1-5/10', 'bytes 0--1/10', 'bytes 0-5/-10',
    'bytes 0-/10', 'bytes -5/10', 'bytes 0-5', 'bytes 0-5/', 'bytes 0-5/1e2',
    'bytes +0-5/10', 'bytes 0-5/+10', 'bytes 0.0-5/10', 'bytes 0-5/0xa',
    'bytes=0-5/10', 'bytes\t0-5/10', 'bytes  0-5/10', 'bytes 0 -5/10',
    'bytes 0- 5/10', 'bytes 0-5 /10', 'bytes 0-5/ 10',
    'bytes 0-5/10\n', '\rbytes 0-5/10', 'bytes 0-5/10 trailing',
    'bytes 0-5/10, bytes 6-9/10',
  ])('rejects malformed or repeated fields %j', (input) => {
    expect(parseContentRange(input)).toBeNull();
  });

  it('does not interpret unknown units as bytes', () => {
    expect(parseContentRange('items 0-4/10')).toBeNull();
    expect(parseContentRange('exampleunit 1.2-4.3/25')).toBeNull();
    expect(parseContentRange('items */10')).toBeNull();
  });
});
