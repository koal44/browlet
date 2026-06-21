import { describe, expect, it } from 'vitest';
import { Cursor } from '../../../src/selectlet/parser/cursor';
import { consumeTrivia } from '../../../src/selectlet/parser/lex';
import {
  allOf, oneOf, optionalPart, parseUnorderedAll, parseUnorderedSome, part, sequence, someOf,
  type TryValueParser,
} from '../../../src/stylelet/parser/component';


const literalParser = <T extends string>(expected: T): TryValueParser<T> => {
  return (c: Cursor): T | null => {
    const start = c.pos();

    consumeTrivia(c);

    for (let i = 0; i < expected.length; i++) {
      if (c.peek() !== expected[i]) {
        c.restore(start);
        return null;
      }

      c.advance();
    }

    return expected;
  };
};

const parseA = literalParser('a');
const parseB = literalParser('b');
const parseC = literalParser('c');

function expectDone(c: Cursor): void {
  consumeTrivia(c);
  expect(c.peek()).toBe('');
}

describe('component value combinators', () => {
  it('parses unordered all-of components in grammar order', () => {
    const c = new Cursor('a b');

    const result = parseUnorderedAll(c, [
      part('a', parseA),
      part('b', parseB),
    ]);

    expect(result).toMatchObject({ a: 'a', b: 'b' });
    expectDone(c);
  });

  it('parses unordered all-of components in swapped order', () => {
    const c = new Cursor('b a');

    const result = parseUnorderedAll(c, [
      part('a', parseA),
      part('b', parseB),
    ]);

    expect(result).toMatchObject({ a: 'a', b: 'b' });
    expectDone(c);
  });

  it('allows optional components in unordered all-of groups', () => {
    const c = new Cursor('a');

    const result = parseUnorderedAll(c, [
      part('a', parseA),
      optionalPart('b', parseB),
    ]);

    expect(result).toMatchObject({ a: 'a' });
    expect(result.b).toBeUndefined();
    expectDone(c);
  });

  it('parses optional components before required components', () => {
    const c = new Cursor('b a');

    const result = parseUnorderedAll(c, [
      part('a', parseA),
      optionalPart('b', parseB),
    ]);

    expect(result).toMatchObject({ a: 'a', b: 'b' });
    expectDone(c);
  });

  it('throws when required unordered all-of components are missing', () => {
    const c = new Cursor('b');

    expect(() => parseUnorderedAll(c, [
      part('a', parseA),
      optionalPart('b', parseB),
    ])).toThrow('Expected a');
  });

  it('parses unordered some-of components with one match', () => {
    const c = new Cursor('a');

    const result = parseUnorderedSome(c, [
      part('a', parseA),
      part('b', parseB),
    ]);

    expect(result).toMatchObject({ a: 'a' });
    expectDone(c);
  });

  it('parses unordered some-of components with multiple matches in any order', () => {
    const c = new Cursor('b a');

    const result = parseUnorderedSome(c, [
      part('a', parseA),
      part('b', parseB),
    ]);

    expect(result).toMatchObject({ a: 'a', b: 'b' });
    expectDone(c);
  });

  it('throws when unordered some-of components do not match', () => {
    const c = new Cursor('d');

    expect(() => parseUnorderedSome(c, [
      part('a', parseA),
      part('b', parseB),
    ])).toThrow('Expected one or more value components');
  });

  it('leaves duplicate components for the caller to reject', () => {
    const c = new Cursor('a a');

    const result = parseUnorderedSome(c, [
      part('a', parseA),
      part('b', parseB),
    ]);

    expect(result).toMatchObject({ a: 'a' });

    consumeTrivia(c);
    expect(c.peek()).toBe('a');
  });

  it('does not interleave inside grouped components', () => {
    const groupedBC: TryValueParser<readonly ['b', 'c']> = (c: Cursor) => {
      const start = c.pos();

      const bv = parseB(c);
      if (bv === null) {
        c.restore(start);
        return null;
      }

      consumeTrivia(c);

      const cv = parseC(c);
      if (cv === null) {
        c.restore(start);
        return null;
      }

      return [bv, cv];
    };

    const valid = new Cursor('a b c');

    expect(parseUnorderedSome(valid, [
      part('a', parseA),
      part('bc', groupedBC),
    ])).toMatchObject({
      a: 'a',
      bc: ['b', 'c'],
    });

    expectDone(valid);

    const invalid = new Cursor('b a c');

    expect(() => parseUnorderedSome(invalid, [
      part('a', parseA),
      part('bc', groupedBC),
    ])).toThrow('Expected one or more value components');
  });

  it('parses juxtaposed components with sequence', () => {
    const c = new Cursor('a b');

    const parseAB = sequence(parseA, parseB);
    const result = parseAB(c);

    expect(result).toEqual(['a', 'b']);
    expectDone(c);
  });

  it('parses alternatives with oneOf', () => {
    const c = new Cursor('b');

    const parseAOrB = oneOf(parseA, parseB);
    const result = parseAOrB(c);

    expect(result).toBe('b');
    expectDone(c);
  });

  it('returns null from oneOf when no alternatives match', () => {
    const c = new Cursor('c');

    const parseAOrB = oneOf(parseA, parseB);

    expect(parseAOrB(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('composes the spec precedence example', () => {
    const parseD = literalParser('d');
    const parseE = literalParser('e');
    const parseF = literalParser('f');

    const parseAB = sequence(parseA, parseB);
    const parseEF = sequence(parseE, parseF);

    const parseDAndEF = allOf([
      part('d', parseD),
      part('ef', parseEF),
    ]);

    const parseCOrDAndEF = someOf([
      part('c', parseC),
      part('dAndEf', parseDAndEF),
    ]);

    const parseWhole = oneOf(
      parseAB,
      parseCOrDAndEF,
    );

    const ab = new Cursor('a b');
    expect(parseWhole(ab)).toEqual(['a', 'b']);
    expectDone(ab);

    const reordered = new Cursor('e f d c');
    expect(parseWhole(reordered)).toMatchObject({
      c: 'c',
      dAndEf: {
        d: 'd',
        ef: ['e', 'f'],
      },
    });
    expectDone(reordered);
  });


});
