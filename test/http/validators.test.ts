import { describe, expect, it } from 'vitest';

import {
  EntityTag, isStrongLastModified, matchesIfRange, parseEntityTagList,
  parseIfRange, selectIfRangeValidator, serializeEntityTagList,
} from '../../src/http/validators';

const now = Date.UTC(2026, 8, 24);
const modified = Date.UTC(1994, 10, 6, 8, 49, 37);

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
    '', '*', 'xyzzy', '"unterminated', 'w/"xyzzy"', 'W /"xyzzy"', 'W/ "xyzzy"',
    '"a b"', '"a\tb"', '"a\nb"', '"a\rb"', '"\0"', '"\x7f"', '"\u0100"',
    '"x" trailing', '"x", "y"', '"x""y"', '"a\\"b"', '"x"\n', '\n"x"',
  ])('rejects malformed or repeated tags %j', (input) => {
    expect(EntityTag.parse(input)).toBeNull();
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

describe('Last-Modified validator strength (RFC 9110 §8.8.2.2)', () => {
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

describe('If-Range (RFC 9110 §13.1.5)', () => {
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

  it('parses tags and all three HTTP-date forms', () => {
    expect(parseIfRange('"x"', now)).toEqual(new EntityTag('x'));
    expect(parseIfRange('W/"x"', now)).toEqual(new EntityTag('x', true));
    for (const date of [
      'Sun, 06 Nov 1994 08:49:37 GMT', 'Sunday, 06-Nov-94 08:49:37 GMT',
      'Sun Nov  6 08:49:37 1994',
    ]) expect(parseIfRange(date, now)).toBe(modified);
  });

  it.each([
    '', '*', '"a", "b"', 'w/"a"', '"a"\n', '0',
    'Sun, 06 Nov 1994 08:49:37 GMT, Sun, 06 Nov 1994 08:49:37 GMT',
  ])('rejects malformed If-Range values %j', (input) => {
    expect(parseIfRange(input, now)).toBeNull();
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
});
