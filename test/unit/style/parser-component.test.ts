import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../src/stylelet/parser/component-cursor';
import { isIdentToken, parseListOfComponentValues } from '../../../src/stylelet/parser/syntax';
import { TokenKind } from '../../../src/stylelet/parser/tokens';
import {
  allOf, consumeComponentTrivia, one, oneOf, optionalPart, parseUnorderedAll, parseUnorderedSome, part, repeat, repeatComma, required, sequence, someOf,
  type TryValueParser,
} from '../../../src/stylelet/parser/component';

const cursor = (css: string): ComponentCursor =>
  new ComponentCursor(parseListOfComponentValues(css));

const literalParser = <T extends string>(expected: T): TryValueParser<T> => {
  return (c: ComponentCursor): T | null => {
    const start = c.pos();

    consumeComponentTrivia(c);

    const comp = c.next();

    if (
      comp === null ||
      !isIdentToken(comp) ||
      comp.value.toLowerCase() !== expected
    ) {
      c.restore(start);
      return null;
    }

    return expected;
  };
};

const parseA = literalParser('a');
const parseB = literalParser('b');
const parseC = literalParser('c');

function expectDone(c: ComponentCursor): void {
  consumeComponentTrivia(c);
  expect(c.peek()).toBeNull();
}

function expectNextIdent(c: ComponentCursor, expected: string): void {
  consumeComponentTrivia(c);

  const value = c.peek();

  expect(value).toMatchObject({
    kind: TokenKind.Ident,
    value: expected,
  });
}

function expectNextComma(c: ComponentCursor): void {
  consumeComponentTrivia(c);

  const value = c.peek();

  expect(value).toMatchObject({
    kind: TokenKind.Comma,
  });
}

describe('component value combinators', () => {
  it('parses unordered all-of components in grammar order', () => {
    const c = cursor('a b');

    const result = parseUnorderedAll(c, [
      part('a', one(parseA)),
      part('b', one(parseB)),
    ]);

    expect(result).toMatchObject({ a: ['a'], b: ['b'] });
    expectDone(c);
  });

  it('parses unordered all-of components in swapped order', () => {
    const c = cursor('b a');

    const result = parseUnorderedAll(c, [
      part('a', one(parseA)),
      part('b', one(parseB)),
    ]);

    expect(result).toMatchObject({ a: ['a'], b: ['b'] });
    expectDone(c);
  });

  it('allows optional components in unordered all-of groups', () => {
    const c = cursor('a');

    const result = parseUnorderedAll(c, [
      part('a', one(parseA)),
      optionalPart('b', one(parseB)),
    ]);

    expect(result).toMatchObject({ a: ['a'] });
    expect(result.b).toBeUndefined();
    expectDone(c);
  });

  it('parses optional components before required components', () => {
    const c = cursor('b a');

    const result = parseUnorderedAll(c, [
      part('a', one(parseA)),
      optionalPart('b', one(parseB)),
    ]);

    expect(result).toMatchObject({ a: ['a'], b: ['b'] });
    expectDone(c);
  });

  it('throws when required unordered all-of components are missing', () => {
    const c = cursor('b');

    expect(() => parseUnorderedAll(c, [
      part('a', one(parseA)),
      optionalPart('b', one(parseB)),
    ])).toThrow('Expected a');
  });

  it('parses unordered some-of components with one match', () => {
    const c = cursor('a');

    const result = parseUnorderedSome(c, [
      part('a', one(parseA)),
      part('b', one(parseB)),
    ]);

    expect(result).toMatchObject({ a: ['a'] });
    expectDone(c);
  });

  it('parses unordered some-of components with multiple matches in any order', () => {
    const c = cursor('b a');

    const result = parseUnorderedSome(c, [
      part('a', one(parseA)),
      part('b', one(parseB)),
    ]);

    expect(result).toMatchObject({ a: ['a'], b: ['b'] });
    expectDone(c);
  });

  it('throws when unordered some-of components do not match', () => {
    const c = cursor('d');

    expect(() => parseUnorderedSome(c, [
      part('a', one(parseA)),
      part('b', one(parseB)),
    ])).toThrow('Expected one or more value components');
  });

  it('leaves duplicate components for the caller to reject', () => {
    const c = cursor('a a');

    const result = parseUnorderedSome(c, [
      part('a', one(parseA)),
      part('b', one(parseB)),
    ]);

    expect(result).toMatchObject({ a: ['a'] });

    expectNextIdent(c, 'a');
  });

  it('does not interleave inside grouped components', () => {
    const groupedBC: TryValueParser<readonly ['b', 'c']> = (c: ComponentCursor) => {
      const start = c.pos();

      const bv = parseB(c);
      if (bv === null) {
        c.restore(start);
        return null;
      }

      consumeComponentTrivia(c);

      const cv = parseC(c);
      if (cv === null) {
        c.restore(start);
        return null;
      }

      return [bv, cv];
    };

    const valid = cursor('a b c');

    expect(parseUnorderedSome(valid, [
      part('a', one(parseA)),
      part('bc', one(groupedBC)),
    ])).toMatchObject({
      a: ['a'],
      bc: [['b', 'c']],
    });

    expectDone(valid);

    const invalid = cursor('b a c');

    expect(() => parseUnorderedSome(invalid, [
      part('a', one(parseA)),
      part('bc', one(groupedBC)),
    ])).toThrow('Expected one or more value components');
  });

  it('parses juxtaposed components with sequence', () => {
    const c = cursor('a b');

    const parseAB = sequence(one(parseA), one(parseB));
    const result = parseAB(c);

    expect(result).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('parses alternatives with oneOf', () => {
    const c = cursor('b');

    const parseAOrB = oneOf(one(parseA), one(parseB));
    const result = parseAOrB(c);

    expect(result).toEqual(['b']);
    expectDone(c);
  });

  it('returns null from oneOf when no alternatives match', () => {
    const c = cursor('c');

    const parseAOrB = oneOf(one(parseA), one(parseB));

    expect(parseAOrB(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('composes the spec precedence example', () => {
    const parseD = literalParser('d');
    const parseE = literalParser('e');
    const parseF = literalParser('f');

    const parseAB = sequence(one(parseA), one(parseB));
    const parseEF = sequence(one(parseE), one(parseF));

    const parseDAndEF = allOf([
      part('d', one(parseD)),
      part('ef', parseEF),
    ]);

    const parseCOrDAndEF = someOf([
      part('c', one(parseC)),
      part('dAndEf', parseDAndEF),
    ]);

    const parseWhole = oneOf(
      parseAB,
      parseCOrDAndEF,
    );

    const ab = cursor('a b');
    expect(parseWhole(ab)).toEqual([['a'], ['b']]);
    expectDone(ab);

    const reordered = cursor('e f d c');
    expect(parseWhole(reordered)).toMatchObject({
      c: ['c'],
      dAndEf: {
        d: ['d'],
        ef: [['e'], ['f']],
      },
    });
    expectDone(reordered);
  });

  it('parses zero-or-more repetitions', () => {
    const c = cursor('b');

    // a*
    const parseAStar = repeat(parseA, 0);
    const result = parseAStar(c);

    expect(result).toEqual([]);
    expect(c.pos()).toBe(0);
  });

  it('parses one-or-more repetitions', () => {
    const c = cursor('a a b');

    // a+
    const parseAPlus = repeat(parseA, 1);
    const result = parseAPlus(c);

    expect(result).toEqual(['a', 'a']);

    expectNextIdent(c, 'b');
  });

  it('parses bounded repetitions', () => {
    const c = cursor('a a a a');

    // a{1,3}
    const parseOneToThreeA = repeat(parseA, 1, 3);
    const result = parseOneToThreeA(c);

    expect(result).toEqual(['a', 'a', 'a']);
    expectNextIdent(c, 'a');
  });

  it('returns null when repetition minimum is not met', () => {
    const c = cursor('a');

    // a{2,3}
    const parseTwoToThreeA = repeat(parseA, 2, 3);

    expect(parseTwoToThreeA(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('uses zero-to-one repetition as an optional component in sequence', () => {
    // a? b
    const parseMaybeAThenB = sequence(
      repeat(parseA, 0, 1),
      one(parseB),
    );

    const withA = cursor('a b');
    expect(parseMaybeAThenB(withA)).toEqual([['a'], ['b']]);
    expectDone(withA);

    const withoutA = cursor('b');
    expect(parseMaybeAThenB(withoutA)).toEqual([[], ['b']]);
    expectDone(withoutA);
  });

  it('parses comma-separated repetitions', () => {
    const c = cursor('a, a, a');

    // a#
    const parseACommaList = repeatComma(parseA);
    const result = parseACommaList(c);

    expect(result).toEqual(['a', 'a', 'a']);
    expectDone(c);
  });

  it('parses bounded comma-separated repetitions', () => {
    const c = cursor('a, a, a');

    // a#{1,2}
    const parseOneToTwoA = repeatComma(parseA, 1, 2);
    const result = parseOneToTwoA(c);

    expect(result).toEqual(['a', 'a']);
    expectNextComma(c);
  });

  it('leaves trailing comma for the caller to reject', () => {
    const c = cursor('a,');

    // a#
    const parseACommaList = repeatComma(parseA);
    const result = parseACommaList(c);

    expect(result).toEqual(['a']);
    expectNextComma(c);
  });

  it('returns null when comma-separated repetition minimum is not met', () => {
    const c = cursor('b');

    // a#
    const parseACommaList = repeatComma(parseA);

    expect(parseACommaList(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('wraps try parsers as required parsers', () => {
    // a!
    const parseRequiredA = required(one(parseA), 'Expected a');

    const valid = cursor('a');
    expect(parseRequiredA(valid)).toEqual(['a']);
    expectDone(valid);

    const invalid = cursor('b');
    expect(() => parseRequiredA(invalid)).toThrow('Expected a');
    expect(invalid.pos()).toBe(0);
  });

  it('throws when a repeated parser succeeds without consuming input', () => {
    const parseEmpty: TryValueParser<'empty'> = () => 'empty';

    const c = cursor('a');

    // empty+
    expect(() => repeat(parseEmpty, 1)(c)).toThrow('Repeated parser matched without consuming input');
  });

  it('parses exact repetitions', () => {
    const c = cursor('a a b');

    // a{2}
    const parseExactlyTwoA = repeat(parseA, 2, 2);
    const result = parseExactlyTwoA(c);

    expect(result).toEqual(['a', 'a']);
    expectNextIdent(c, 'b');
  });

  it('parses zero exact repetitions', () => {
    const c = cursor('a');

    // a{0}
    const parseExactlyZeroA = repeat(parseA, 0, 0);
    const result = parseExactlyZeroA(c);

    expect(result).toEqual([]);
    expect(c.pos()).toBe(0);
  });

  it('restores after partial repetition when minimum is not met', () => {
    const c = cursor('a b');

    // a{2,3}
    const parseTwoToThreeA = repeat(parseA, 2, 3);

    expect(parseTwoToThreeA(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('leaves repetitions beyond the default supported limit for the caller to reject', () => {
    const css = Array.from({ length: 21 }, () => 'a').join(' ');
    const c = cursor(css);

    // a+
    const parseAPlus = repeat(parseA, 1);
    const result = parseAPlus(c);

    expect(result).toHaveLength(20);
    expectNextIdent(c, 'a');
  });

  it('parses zero-or-more comma repetitions', () => {
    const c = cursor('b');

    // a#?
    const parseOptionalACommaList = repeatComma(parseA, 0);
    const result = parseOptionalACommaList(c);

    expect(result).toEqual([]);
    expect(c.pos()).toBe(0);
  });

  it('restores comma-separated repetitions when minimum is not met', () => {
    const c = cursor('a');

    // a#{2,3}
    const parseTwoToThreeA = repeatComma(parseA, 2, 3);

    expect(parseTwoToThreeA(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('does not parse a comma-separated repetition without a first item', () => {
    const c = cursor(', a');

    // a#
    const parseACommaList = repeatComma(parseA);

    expect(parseACommaList(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('allows whitespace around comma separators', () => {
    const c = cursor('a ,  a');

    // a#
    const parseACommaList = repeatComma(parseA);
    const result = parseACommaList(c);

    expect(result).toEqual(['a', 'a']);
    expectDone(c);
  });

  it('leaves comma repetitions beyond the default supported limit for the caller to reject', () => {
    const css = Array.from({ length: 21 }, () => 'a').join(', ');
    const c = cursor(css);

    // a#
    const parseACommaList = repeatComma(parseA);
    const result = parseACommaList(c);

    expect(result).toHaveLength(20);
    expectNextComma(c);
  });

  it('throws when a comma-repeated parser succeeds without consuming input', () => {
    const parseEmpty: TryValueParser<'empty'> = () => 'empty';

    const c = cursor('a');

    // empty#
    expect(() => repeatComma(parseEmpty)(c)).toThrow('Comma repeated parser matched without consuming input');
  });

  it('matches zero or more components in order: A? B? C?', () => {
    // A? B? C?
    const parseZeroOrMoreInOrder = sequence(
      repeat(parseA, 0, 1),
      repeat(parseB, 0, 1),
      repeat(parseC, 0, 1),
    );

    const empty = cursor('');
    expect(parseZeroOrMoreInOrder(empty)).toEqual([[], [], []]);
    expectDone(empty);

    const sparse = cursor('a c');
    expect(parseZeroOrMoreInOrder(sparse)).toEqual([['a'], [], ['c']]);
    expectDone(sparse);
  });

  it('matches one or more components in order: [ A? B? C? ]!', () => {
    // [ A? B? C? ]!
    const parseOneOrMoreInOrder = required(
      sequence(
        repeat(parseA, 0, 1),
        repeat(parseB, 0, 1),
        repeat(parseC, 0, 1),
      ),
      'Expected one or more of a, b, c',
    );

    const empty = cursor('');
    expect(() => parseOneOrMoreInOrder(empty)).toThrow('Expected one or more of a, b, c');

    const value = cursor('b c');
    expect(parseOneOrMoreInOrder(value)).toEqual([[], ['b'], ['c']]);
    expectDone(value);
  });

  it('matches all components in order: A B C', () => {
    // A B C
    const parseAllInOrder = sequence(
      one(parseA),
      one(parseB),
      one(parseC),
    );

    const valid = cursor('a b c');
    expect(parseAllInOrder(valid)).toEqual([['a'], ['b'], ['c']]);
    expectDone(valid);

    const invalid = cursor('a c');
    expect(parseAllInOrder(invalid)).toBeNull();
    expect(invalid.pos()).toBe(0);
  });

  it('matches zero or more components in any order: A? || B? || C?', () => {
    const parts = [
      optionalPart('a', one(parseA)),
      optionalPart('b', one(parseB)),
      optionalPart('c', one(parseC)),
    ];

    // A? || B? || C?
    const empty = cursor('');
    expect(parseUnorderedAll(empty, parts)).toMatchObject({});
    expectDone(empty);

    const reordered = cursor('c a');
    expect(parseUnorderedAll(reordered, parts)).toMatchObject({
      a: ['a'],
      c: ['c'],
    });
    expectDone(reordered);
  });

  it('matches one or more components in any order: A || B || C', () => {
    const parts = [
      part('a', one(parseA)),
      part('b', one(parseB)),
      part('c', one(parseC)),
    ];

    // A || B || C
    const c = cursor('b');
    expect(parseUnorderedSome(c, parts)).toMatchObject({
      b: ['b'],
    });
    expectDone(c);

    const reordered = cursor('c a');
    expect(parseUnorderedSome(reordered, parts)).toMatchObject({
      a: ['a'],
      c: ['c'],
    });
    expectDone(reordered);

    const empty = cursor('');
    expect(() => parseUnorderedSome(empty, parts)).toThrow('Expected one or more value components');
  });

  it('matches all components in any order: A && B && C', () => {
    const parts = [
      part('a', one(parseA)),
      part('b', one(parseB)),
      part('c', one(parseC)),
    ];

    // A && B && C
    const reordered = cursor('c a b');
    expect(parseUnorderedAll(reordered, parts)).toMatchObject({
      a: ['a'],
      b: ['b'],
      c: ['c'],
    });
    expectDone(reordered);

    const missing = cursor('c a');
    expect(() => parseUnorderedAll(missing, parts)).toThrow('Expected b');
  });

  it('matches zero or more components in any order: A? || B? || C?', () => {
    const parts = [
      optionalPart('a', one(parseA)),
      optionalPart('b', one(parseB)),
      optionalPart('c', one(parseC)),
    ];

    // A? || B? || C?
    const empty = cursor('');
    expect(parseUnorderedSome(empty, parts)).toMatchObject({});
    expectDone(empty);

    const reordered = cursor('c a');
    expect(parseUnorderedSome(reordered, parts)).toMatchObject({
      a: ['a'],
      c: ['c'],
    });
    expectDone(reordered);
  });

  it('allows comments between juxtaposed components', () => {
    const c = cursor('a/**/b');

    const parseAB = sequence(one(parseA), one(parseB));

    expect(parseAB(c)).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('allows comments around comma separators', () => {
    const c = cursor('a/**/,/**/a');

    const parseACommaList = repeatComma(parseA);

    expect(parseACommaList(c)).toEqual(['a', 'a']);
    expectDone(c);
  });

  it('keeps exclusive alternatives outside unordered groups', () => {
    const parseNone = literalParser('none');
    const parseUnderline = literalParser('underline');
    const parseOverline = literalParser('overline');
    const parseLineThrough = literalParser('line-through');
    const parseBlink = literalParser('blink');

    // none | underline || overline || line-through || blink
    const parseTextDecorationLine = oneOf(
      one(parseNone),
      someOf([
        part('underline', one(parseUnderline)),
        part('overline', one(parseOverline)),
        part('lineThrough', one(parseLineThrough)),
        part('blink', one(parseBlink)),
      ]),
    );

    // combinator precedence should not allow this to be parsed as
    // // (none | underline) || overline || line-through || blink
    // const parseTextDecorationLine_Wrong = oneOf(
    //   oneOf(one(parseNone), one(parseUnderline)),
    //   someOf([
    //     part('overline', one(parseOverline)),
    //     part('lineThrough', one(parseLineThrough)),
    //     part('blink', one(parseBlink)),
    //   ]),
    // );

    const none = cursor('none');
    expect(parseTextDecorationLine(none)).toEqual(['none']);
    expectDone(none);

    const reordered = cursor('overline underline');
    expect(parseTextDecorationLine(reordered)).toMatchObject({
      underline: ['underline'],
      overline: ['overline'],
    });
    expectDone(reordered);

    const invalid = cursor('none overline');
    expect(parseTextDecorationLine(invalid)).toEqual(['none']);
    expectNextIdent(invalid, 'overline');
  });

});
