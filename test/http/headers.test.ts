import { describe, expect, it } from 'vitest';

import {
  EntityTag, isStrongLastModified, matchesIfRange, parseContentRange, parseEntityTagList,
  parseHTTPDate, parseIfRange, parseRetryAfter, selectIfRangeValidator, serializeEntityTagList, serializeHTTPDate,
} from '../../src/http/headers';

describe('HTTP dates (RFC 9110 §5.6.7)', () => {
  const now = Date.UTC(2026, 8, 7, 12);
  const example = Date.UTC(1994, 10, 6, 8, 49, 37);

  describe('parsing', () => {
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
  });

  describe('serialization', () => {
    it('emits IMF-fixdate with UTC and whole-second precision', () => {
      expect(serializeHTTPDate(example)).toBe('Sun, 06 Nov 1994 08:49:37 GMT');
      expect(serializeHTTPDate(example + 999)).toBe('Sun, 06 Nov 1994 08:49:37 GMT');
      expect(serializeHTTPDate(0)).toBe('Thu, 01 Jan 1970 00:00:00 GMT');
    });

    it.each([
      'Sat, 01 Jan 0000 00:00:00 GMT',
      'Mon, 01 Jan 0001 00:00:00 GMT',
      'Tue, 29 Feb 2000 12:34:56 GMT',
      'Fri, 31 Dec 9999 23:59:59 GMT',
    ])('round-trips %s', (input) => {
      expect(serializeHTTPDate(parseHTTPDate(input, now)!)).toBe(input);
    });

    it.each([NaN, Infinity, -Infinity, Date.UTC(-1, 0, 1), Date.UTC(10000, 0, 1)])(
      'rejects a time outside HTTP-date syntax: %s', (value) => {
        expect(serializeHTTPDate(value)).toBeNull();
      },
    );
  });
});

describe('entity tags (RFC 9110 §8.8.3)', () => {
  it.each([
    ['"xyzzy"', 'xyzzy', false],
    ['W/"xyzzy"', 'xyzzy', true],
    ['""', '', false],
    ['W/""', '', true],
    ['\t "xyzzy" \t', 'xyzzy', false],
    ['"a,b"', 'a,b', false],
    ['"a\\b"', 'a\\b', false],
    ['"a\\"', 'a\\', false],
    ['"\x80\xff"', '\x80\xff', false],
  ])('parses %j without unescaping', (input, value, weak) => {
    const tag = EntityTag.parse(input);
    expect(tag).toEqual(new EntityTag(value, weak));
    expect(EntityTag.parse(tag!.serialize())).toEqual(tag);
  });

  it.each([
    ['W/"1"', 'W/"1"', false, true],
    ['W/"1"', 'W/"2"', false, false],
    ['W/"1"', '"1"', false, true],
    ['"1"', 'W/"1"', false, true],
    ['"1"', '"1"', true, true],
    ['"abc"', '"ABC"', false, false],
    ['"a\\b"', '"ab"', false, false],
    ['""', '""', true, true],
    ['"123-a"', '"123-b"', false, false],
  ])('compares %s with %s', (left, right, strong, weak) => {
    const tag = EntityTag.parse(left)!;
    const other = EntityTag.parse(right)!;
    expect(tag.matches(other, 'strong')).toBe(strong);
    expect(tag.matches(other, 'weak')).toBe(weak);
  });

  it.each([
    '', '*', 'xyzzy', '"unterminated', 'w/"xyzzy"', 'W /"xyzzy"', 'W/ "xyzzy"',
    '"a b"', '"a\tb"', '"a\nb"', '"a\rb"', '"\0"', '"\x7f"', '"\u0100"',
    '"x" trailing', '"x", "y"', '"x""y"', '"a\\"b"', '"x"\n', '\n"x"',
  ])('rejects malformed or repeated tags %j', (input) => {
    expect(EntityTag.parse(input)).toBeNull();
  });
});

describe('Last-Modified validator strength (RFC 9110 §8.8.2.2)', () => {
  const modified = Date.UTC(1994, 10, 6, 8, 49, 37);

  it('requires at least one second and evidence that relative clock values are reliable', () => {
    expect(isStrongLastModified(modified, modified + 1000, true)).toBe(true);
    expect(isStrongLastModified(modified, modified + 999, true)).toBe(false);
    expect(isStrongLastModified(modified, modified, true)).toBe(false);
    expect(isStrongLastModified(modified, modified - 1000, true)).toBe(false);
    expect(isStrongLastModified(modified, modified + 60_000, false)).toBe(false);
  });

  it('requires both parsed dates and treats the epoch as a valid timestamp', () => {
    expect(isStrongLastModified(null, modified, true)).toBe(false);
    expect(isStrongLastModified(modified, null, true)).toBe(false);
    expect(isStrongLastModified(0, 1000, true)).toBe(true);
  });
});

describe('conditional entity-tag lists (RFC 9110 §§13.1.1–13.1.2)', () => {
  it('preserves ordering, duplicates, weak tags, and commas within tags', () => {
    const tags = parseEntityTagList('"xyzzy", W/"a,b", "xyzzy", "a\\b"');
    expect(tags).toEqual([
      new EntityTag('xyzzy'), new EntityTag('a,b', true),
      new EntityTag('xyzzy'), new EntityTag('a\\b'),
    ]);
    expect(serializeEntityTagList(tags!)).toBe('"xyzzy", W/"a,b", "xyzzy", "a\\b"');
  });

  it('retains a lone wildcard distinctly from an empty list or empty tag', () => {
    expect(parseEntityTagList(' \t*\t ')).toBe('*');
    expect(serializeEntityTagList('*')).toBe('*');
    expect(parseEntityTagList('')).toEqual([]);
    expect(parseEntityTagList(' , ,\t, ')).toEqual([]);
    expect(serializeEntityTagList([])).toBe('');
    expect(parseEntityTagList('""')).toEqual([new EntityTag('')]);
  });

  it('accepts empty list members and a backslash immediately before a closing quote', () => {
    expect(parseEntityTagList(', "a\\",, \tW/"b", '))
      .toEqual([new EntityTag('a\\'), new EntityTag('b', true)]);
  });

  it.each([
    '*, "x"', '"x", *', '*, *', ',*', '*,', '"x", invalid',
    '"x" "y"', '"x", w/"y"', '"x", "unclosed', '"x", "bad space"',
    '"x", "y"\n', '"x"; "y"',
  ])('rejects malformed conditional lists %j', (input) => {
    expect(parseEntityTagList(input)).toBeNull();
  });
});

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

describe('If-Range (RFC 9110 §13.1.5)', () => {
  const now = Date.UTC(2026, 8, 24);
  const modified = Date.UTC(1994, 10, 6, 8, 49, 37);

  it('parses tags and all three HTTP-date forms', () => {
    expect(parseIfRange('"x"', now)).toEqual(new EntityTag('x'));
    expect(parseIfRange('W/"x"', now)).toEqual(new EntityTag('x', true));
    for (const date of [
      'Sun, 06 Nov 1994 08:49:37 GMT', 'Sunday, 06-Nov-94 08:49:37 GMT',
      'Sun Nov  6 08:49:37 1994',
    ]) expect(parseIfRange(date, now)).toBe(modified);
  });

  it('selects the strong entity tag even when a reliable date exists', () => {
    const tag = new EntityTag('1');
    expect(selectIfRangeValidator(tag, modified, modified + 1000, true)).toBe(tag);
    expect(selectIfRangeValidator(tag, null, null, false)).toBe(tag);
  });

  it('does not substitute a date for a weak entity tag', () => {
    expect(selectIfRangeValidator(new EntityTag('1', true), modified, modified + 1000, true))
      .toBeNull();
  });

  it('selects a date only without an entity tag and with sufficient clock evidence', () => {
    expect(selectIfRangeValidator(null, modified, modified + 1000, true)).toBe(modified);
    expect(selectIfRangeValidator(null, modified, modified + 1000, false)).toBeNull();
    expect(selectIfRangeValidator(null, modified, modified, true)).toBeNull();
    expect(selectIfRangeValidator(null, null, modified, true)).toBeNull();
  });

  it('requires strong entity-tag equality', () => {
    expect(matchesIfRange(new EntityTag('1'), new EntityTag('1'), null, false)).toBe(true);
    expect(matchesIfRange(new EntityTag('1', true), new EntityTag('1'), null, false)).toBe(false);
    expect(matchesIfRange(new EntityTag('1'), new EntityTag('1', true), null, false)).toBe(false);
    expect(matchesIfRange(new EntityTag('1'), new EntityTag('2'), null, false)).toBe(false);
    expect(matchesIfRange(new EntityTag('1'), null, modified, true)).toBe(false);
  });

  it('requires a strong date and exact equality in either direction', () => {
    expect(matchesIfRange(modified, null, modified, true)).toBe(true);
    expect(matchesIfRange(modified, null, modified, false)).toBe(false);
    expect(matchesIfRange(modified, null, modified - 1000, true)).toBe(false);
    expect(matchesIfRange(modified, null, modified + 1000, true)).toBe(false);
    expect(matchesIfRange(modified, new EntityTag('1'), null, true)).toBe(false);
  });

  it.each([
    '', '*', '"a", "b"', 'w/"a"', '"a"\n', '0',
    'Sun, 06 Nov 1994 08:49:37 GMT, Sun, 06 Nov 1994 08:49:37 GMT',
  ])('rejects malformed If-Range values %j', (input) => {
    expect(parseIfRange(input, now)).toBeNull();
  });
});

describe('Retry-After (RFC 9110 §10.2.3)', () => {
  const now = Date.UTC(2026, 8, 24);

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
