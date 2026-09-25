import { describe, expect, it } from 'vitest';
import { parseRetryAfter } from '../../src/http/retry-after';

const now = Date.UTC(2026, 8, 24);

describe('Retry-After (RFC 9110 §10.2.3)', () => {
  it.each([
    ['120', 120n], ['0', 0n], ['000120', 120n], ['\t 120 \t', 120n],
    ['90071992547409931234567890', 90071992547409931234567890n],
  ] as const)('preserves the exact delay in %j', (input, delaySeconds) => {
    expect(parseRetryAfter(input, now)).toEqual({ delaySeconds });
  });

  it.each([
    'Fri, 31 Dec 1999 23:59:59 GMT',
    'Friday, 31-Dec-99 23:59:59 GMT',
    'Fri Dec 31 23:59:59 1999',
  ])('accepts an absolute date even when already past: %s', (input) => {
    expect(parseRetryAfter(input, now)).toEqual({ date: Date.UTC(1999, 11, 31, 23, 59, 59) });
  });

  it.each([
    '', ' \t ', '-1', '+1', '1.5', '1e3', 'Infinity', '１２', '1 2', '120 seconds',
    '"120"', '120, 240', '120\r\n',
    '2026-09-24T00:00:00Z', 'Fri, 31 Dec 1999 23:59:59 GMT, 120',
  ])('rejects malformed or combined values: %j', (input) => {
    expect(parseRetryAfter(input, now)).toBeNull();
  });
});
