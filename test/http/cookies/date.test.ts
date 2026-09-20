import { describe, expect, it } from 'vitest';
import { parseCookieDate } from '../../../src/http/cookies/date';

describe('parse a cookie date (§5.3.1)', () => {
  const example = Date.UTC(2021, 5, 9, 10, 18, 14);

  it.each([
    'Wed, 09 Jun 2021 10:18:14 GMT',
    'Wednesday, 09-Jun-21 10:18:14 GMT',
    'Wed Jun  9 10:18:14 2021',
    '2021 Jun 09 10:18:14',
    '10:18:14 09 jUnE 2021',
    '09junk June99 2021suffix 10:18:14GMT',
    '09 junk 2021 10:18:14:ignored',
    '\t"09/Jun/2021 [10:18:14]"\t',
    'Mon, 09 Jun 2021 10:18:14 PST',
    '09 Jun 2021 10:18:14 +0900',
  ])('accepts %j as UTC without validating the weekday or timezone', (input) => {
    expect(parseCookieDate(input)).toBe(example);
  });

  it.each<[string, number]>([
    ['Jan', 0], ['Feb', 1], ['Mar', 2], ['Apr', 3], ['May', 4], ['Jun', 5],
    ['Jul', 6], ['Aug', 7], ['Sep', 8], ['Oct', 9], ['Nov', 10], ['Dec', 11],
  ])('recognizes month %s', (month, index) => {
    expect(parseCookieDate(`01 ${month} 2021 00:00:00`)).toBe(Date.UTC(2021, index, 1));
  });

  it.each<[string, number]>([
    ['00', 2000], ['01', 2001], ['69', 2069], ['70', 1970], ['99', 1999],
    ['0000', 2000], ['069', 2069], ['0070', 1970], ['1601', 1601], ['9999', 9999],
  ])('interprets year %s as %i independently of the current date', (year, expected) => {
    expect(parseCookieDate(`01 Jan ${year} 00:00:00`)).toBe(Date.UTC(expected, 0, 1));
  });

  it('accepts one-digit clock fields and Gregorian leap days', () => {
    expect(parseCookieDate('29 Feb 2000 1:2:3')).toBe(Date.UTC(2000, 1, 29, 1, 2, 3));
    expect(parseCookieDate('29 Feb 2024 23:59:59')).toBe(Date.UTC(2024, 1, 29, 23, 59, 59));
    expect(parseCookieDate('01 Jan 1970 0:0:0')).toBe(0);
  });

  it.each([
    '', '09 Jun 2021', 'Jun 2021 10:18:14', '09 2021 10:18:14', '09 Jun 10:18:14',
    '00 Jun 2021 10:18:14', '32 Jun 2021 10:18:14', '31 Apr 2021 10:18:14',
    '29 Feb 2021 10:18:14', '29 Feb 1900 10:18:14', '01 Jan 1600 10:18:14',
    '01 Jan 100 10:18:14', '01 Jan 7 10:18:14', '01 Jan 10000 10:18:14',
    '009 Jun 2021 10:18:14', '09 Jun 2021 24:00:00', '09 Jun 2021 10:60:14',
    '09 Jun 2021 10:18:60', '09 Jun 2021 010:18:14', '09 Jun 2021 10:018:14',
    '09 Jun 2021 10:18:014', '09 Jun 2021 10:18', '09 Jun 2021 x10:18:14',
    '09 xJun 2021 10:18:14', 'x09 Jun 2021 10:18:14',
    '69 Jan 01 00:00:00',
  ])('rejects missing or invalid components in %j', (input) => {
    expect(parseCookieDate(input)).toBeNull();
  });

  it('keeps the first recognized value for each component', () => {
    expect(parseCookieDate('09 Jun 2021 10:18:14 25 Dec 2030 20:30:40')).toBe(example);
    expect(parseCookieDate('32 09 Jun 2021 10:18:14')).toBeNull();
    expect(parseCookieDate('09 Jun 1600 2021 10:18:14')).toBeNull();
    expect(parseCookieDate('09 Jun 2021 24:00:00 10:18:14')).toBeNull();
  });

  it('tries the remaining productions after a time has already been found', () => {
    expect(parseCookieDate('10:18:14 09:00:00 Jun 2021')).toBe(example);
    expect(parseCookieDate('09 Jun 10:18:14 21:00:00')).toBe(example);
  });

  it('uses exactly the specified byte delimiters, preserving colons and high bytes within tokens', () => {
    for (let byte = 0; byte <= 0xff; byte++) {
      const delimiter = byte === 0x09 || byte >= 0x20 && byte <= 0x2f ||
        byte >= 0x3b && byte <= 0x40 || byte >= 0x5b && byte <= 0x60 ||
        byte >= 0x7b && byte <= 0x7e;
      const separator = String.fromCharCode(byte);
      const input = `09${separator}Jun${separator}2021${separator}10:18:14`;
      expect(parseCookieDate(input), `separator 0x${byte.toString(16)}`).toBe(delimiter ? example : null);
    }
  });

  it('allows non-digit suffixes without treating them as separators', () => {
    expect(parseCookieDate('09\x80 Jun\xff 2021\x00 10:18:14\x0b')).toBe(example);
    expect(parseCookieDate('noise\x80Jun 09 2021 10:18:14')).toBeNull();
    expect(parseCookieDate('09 Jun 2021\n10:18:14')).toBeNull();
  });
});
