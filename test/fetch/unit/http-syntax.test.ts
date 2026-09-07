import { describe, expect, it } from 'vitest';

import { parseHTTPDate } from '../../../src/fetch/http/syntax';

const now = Date.UTC(2026, 8, 7, 12);
const example = Date.UTC(1994, 10, 6, 8, 49, 37);

describe('HTTP dates (RFC 9110 §5.6.7)', () => {
  it.each([
    'Sun, 06 Nov 1994 08:49:37 GMT',
    'Sunday, 06-Nov-94 08:49:37 GMT',
    'Sun Nov  6 08:49:37 1994',
    'sun, 06 nOv 1994 08:49:37 gMt',
    '\t Sun, 06 Nov 1994 08:49:37 GMT \t',
  ])('accepts %j', (input) => {
    expect(parseHTTPDate(input, now)).toBe(example);
  });

  it('accepts an asctime date with a two-digit day', () => {
    expect(parseHTTPDate('Sun Nov 13 08:49:37 1994', now))
      .toBe(Date.UTC(1994, 10, 13, 8, 49, 37));
  });

  it.each([
    '', '0', '1994-11-06T08:49:37Z',
    'Sun, 06 Nov 1994 08:49:37 UTC',
    'Sun, 06 Nov 1994 08:49:37 +0000',
    'Sun, 6 Nov 1994 08:49:37 GMT',
    'Sun, 06 Nov 1994 8:49:37 GMT',
    'Sun,\t06 Nov 1994 08:49:37 GMT',
    'Sun, 06 Nov 1994 08:49:37 GMT\n',
    'Sun, 06 Nov 1994 08:49:37 GMT\r\n',
    'Sun, 06 Nov 1994 08:49:37 GMT\0',
    'Sun, 06 Nov 1994 08:49:37 GMT, Sun, 06 Nov 1994 08:49:37 GMT',
    'Sun, 06 Nov 1994 08:49:37 GMT trailing',
    'Sun, 06 Nov 1994 24:00:00 GMT',
    'Sun, 06 Nov 1994 08:60:00 GMT',
    'Sun, 06 Nov 1994 08:49:61 GMT',
    'Tue, 29 Feb 2023 00:00:00 GMT',
    'Thu, 31 Apr 2025 00:00:00 GMT',
    'Sun, 00 Nov 1994 08:49:37 GMT',
    'Sun, 06 Unknown 1994 08:49:37 GMT',
    'Funday, 06-Nov-94 08:49:37 GMT',
    'Mon, 06 Nov 1994 08:49:37 GMT',
  ])('rejects an invalid date %j', (input) => {
    expect(parseHTTPDate(input, now)).toBeNull();
  });

  it('accepts a Gregorian leap day and rounds a leap second down', () => {
    expect(parseHTTPDate('Tue, 29 Feb 2000 00:00:00 GMT', now))
      .toBe(Date.UTC(2000, 1, 29));
    expect(parseHTTPDate('Sat, 31 Dec 2016 23:59:60 GMT', now))
      .toBe(Date.UTC(2016, 11, 31, 23, 59, 59));
  });

  it('preserves a four-digit year below 0100', () => {
    const date = new Date(0);
    date.setUTCFullYear(1, 0, 1);
    expect(parseHTTPDate('Mon, 01 Jan 0001 00:00:00 GMT', now)).toBe(date.getTime());
  });

  it.each([
    [Date.UTC(2076, 8, 7, 12), now],
    [Date.UTC(1976, 8, 7, 12, 0, 1), now],
    [Date.UTC(1977, 0, 1), now],
    [Date.UTC(2110, 0, 1), Date.UTC(2090, 0, 1)],
  ])('resolves a two-digit year to %j relative to %j', (expected, reference) => {
    const utc = new Date(expected).toUTCString();
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const day = weekdays[new Date(expected).getUTCDay()]!;
    const input = `${day}, ${utc.slice(5, 7)}-${utc.slice(8, 11)}-${utc.slice(14, 16)} ${utc.slice(17)}`;
    expect(parseHTTPDate(input, reference)).toBe(expected);
  });
});
