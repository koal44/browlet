import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../src/stylelet/parser/component-cursor';
import { consumeComponentTrivia, isIdentToken, parseListOfComponentValues } from '../../../src/stylelet/parser/syntax';
import { TokenKind } from '../../../src/stylelet/parser/tokens';
import {
  allOf, one, oneOf, opt, repeat, repeatComma, required, requiredAllOf, requiredSequence, requiredSomeOf, sequence, someOf,
  withComponentTrivia,
  type TryValueParser,
} from '../../../src/stylelet/parser/component';

const cursor = (css: string): ComponentCursor =>
  new ComponentCursor(parseListOfComponentValues(css));

const literalParser = <T extends string>(expected: T): TryValueParser<T> => {
  return (c: ComponentCursor): T | null => {
    const start = c.pos();
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

const valueLiteralParser = <T extends string>(expected: T): TryValueParser<T> =>
  withComponentTrivia(literalParser(expected));

const parseA = valueLiteralParser('a');
const parseB = valueLiteralParser('b');
const parseC = valueLiteralParser('c');

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

    // a && b
    const parseAAndB = allOf(
      one(parseA),
      one(parseB),
      (value) => value,
    );

    expect(parseAAndB(c)).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('parses unordered all-of components in swapped order', () => {
    const c = cursor('b a');

    // a && b
    const parseAAndB = allOf(
      one(parseA),
      one(parseB),
      (value) => value,
    );

    expect(parseAAndB(c)).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('allows optional components in unordered all-of groups', () => {
    const c = cursor('a');

    // a && b?
    const parseAAndMaybeB = allOf(
      one(parseA),
      opt(parseB),
      (value) => value,
    );

    expect(parseAAndMaybeB(c)).toEqual([['a'], []]);
    expectDone(c);
  });

  it('parses optional components before required components', () => {
    const c = cursor('b a');

    // a && b?
    const parseAAndMaybeB = allOf(
      one(parseA),
      opt(parseB),
      (value) => value,
    );

    expect(parseAAndMaybeB(c)).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('returns null when required unordered all-of components are missing', () => {
    const c = cursor('b');

    // a && b?
    const parseAAndMaybeB = allOf(
      one(parseA),
      opt(parseB),
      (value) => value,
    );

    expect(parseAAndMaybeB(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('parses unordered some-of components with one match', () => {
    const c = cursor('a');

    // a || b
    const parseAOrBOrBoth = someOf(
      one(parseA),
      one(parseB),
      (value) => value,
    );

    expect(parseAOrBOrBoth(c)).toEqual([['a'], undefined]);
    expectDone(c);
  });

  it('parses unordered some-of components with multiple matches in any order', () => {
    const c = cursor('b a');

    // a || b
    const parseAOrBOrBoth = someOf(
      one(parseA),
      one(parseB),
      (value) => value,
    );

    expect(parseAOrBOrBoth(c)).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('returns null when unordered some-of components do not match', () => {
    const c = cursor('d');

    // a || b
    const parseAOrBOrBoth = someOf(
      one(parseA),
      one(parseB),
      (value) => value,
    );

    expect(parseAOrBOrBoth(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('leaves duplicate components for the caller to reject', () => {
    const c = cursor('a a');

    // a || b
    const parseAOrBOrBoth = someOf(
      one(parseA),
      one(parseB),
      (value) => value,
    );

    expect(parseAOrBOrBoth(c)).toEqual([['a'], undefined]);
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

    // a || [ b c ]
    const parseAOrGroupedBCOrBoth = someOf(
      one(parseA),
      one(groupedBC),
      (value) => value,
    );

    const valid = cursor('a b c');

    expect(parseAOrGroupedBCOrBoth(valid)).toEqual([
      ['a'],
      [['b', 'c']],
    ]);

    expectDone(valid);

    const invalid = cursor('b a c');

    expect(parseAOrGroupedBCOrBoth(invalid)).toBeNull();
    expect(invalid.pos()).toBe(0);
  });

  it('parses juxtaposed components with sequence', () => {
    const c = cursor('a b');

    const parseAB = sequence(
      one(parseA),
      one(parseB),
      (value) => value,
    );

    const result = parseAB(c);

    expect(result).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('parses alternatives with oneOf', () => {
    const c = cursor('b');

    const parseAOrB = oneOf(
      one(parseA),
      one(parseB),
      (value) => value,
    );

    const result = parseAOrB(c);

    expect(result).toEqual(['b']);
    expectDone(c);
  });

  it('returns null from oneOf when no alternatives match', () => {
    const c = cursor('c');

    const parseAOrB = oneOf(
      one(parseA),
      one(parseB),
      (value) => value,
    );

    expect(parseAOrB(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  // a b | c || d && e f
  it('composes grammar combinator precedence', () => {
    const parseD = valueLiteralParser('d');
    const parseE = valueLiteralParser('e');
    const parseF = valueLiteralParser('f');

    // a b
    const parseAB = sequence(
      one(parseA),
      one(parseB),
      (value) => value,
    );

    // e f
    const parseEF = sequence(
      one(parseE),
      one(parseF),
      (value) => value,
    );

    // d && e f
    const parseDAndEF = allOf(
      one(parseD),
      one(parseEF),
      ([d, ef]) => [
        d,
        ef![0],
      ],
    );

    // c || d && e f
    const parseCOrDAndEF = someOf(
      one(parseC),
      one(parseDAndEF),
      ([c, dAndEF]) => [
        c,
        dAndEF?.[0],
      ],
    );

    // a b | c || d && e f
    const parseWhole = oneOf(
      one(parseAB),
      one(parseCOrDAndEF),
      ([value]) => value,
    );

    const ab = cursor('a b');
    expect(parseWhole(ab)).toEqual([['a'], ['b']]);
    expectDone(ab);

    const reordered = cursor('e f d c');
    expect(parseWhole(reordered)).toEqual([
      ['c'],
      [
        ['d'],
        [
          ['e'],
          ['f'],
        ],
      ],
    ]);
    expectDone(reordered);

    const partial = cursor('e f d');
    expect(parseWhole(partial)).toEqual([
      undefined,
      [
        ['d'],
        [
          ['e'],
          ['f'],
        ],
      ],
    ]);
    expectDone(partial);
  });

  it('parses zero-or-more repetitions', () => {
    const c = cursor('b');

    // a*
    const parseAStar = repeat(parseA, 0);
    const result = parseAStar.parse(c);

    expect(result).toEqual([]);
    expect(c.pos()).toBe(0);
  });

  it('parses one-or-more repetitions', () => {
    const c = cursor('a a b');

    // a+
    const parseAPlus = repeat(parseA, 1);
    const result = parseAPlus.parse(c);

    expect(result).toEqual(['a', 'a']);

    expectNextIdent(c, 'b');
  });

  it('parses bounded repetitions', () => {
    const c = cursor('a a a a');

    // a{1,3}
    const parseOneToThreeA = repeat(parseA, 1, 3);
    const result = parseOneToThreeA.parse(c);

    expect(result).toEqual(['a', 'a', 'a']);
    expectNextIdent(c, 'a');
  });

  it('returns null when repetition minimum is not met', () => {
    const c = cursor('a');

    // a{2,3}
    const parseTwoToThreeA = repeat(parseA, 2, 3);

    expect(parseTwoToThreeA.parse(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('uses zero-to-one repetition as an optional component in sequence', () => {
    // a? b
    const parseMaybeAThenB = sequence(
      repeat(parseA, 0, 1),
      one(parseB),
      (value) => value,
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
    const result = parseACommaList.parse(c);

    expect(result).toEqual(['a', 'a', 'a']);
    expectDone(c);
  });

  it('parses bounded comma-separated repetitions', () => {
    const c = cursor('a, a, a');

    // a#{1,2}
    const parseOneToTwoA = repeatComma(parseA, 1, 2);
    const result = parseOneToTwoA.parse(c);

    expect(result).toEqual(['a', 'a']);
    expectNextComma(c);
  });

  it('leaves trailing comma for the caller to reject', () => {
    const c = cursor('a,');

    // a#
    const parseACommaList = repeatComma(parseA);
    const result = parseACommaList.parse(c);

    expect(result).toEqual(['a']);
    expectNextComma(c);
  });

  it('returns null when comma-separated repetition minimum is not met', () => {
    const c = cursor('b');

    // a#
    const parseACommaList = repeatComma(parseA);

    expect(parseACommaList.parse(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('wraps try parsers as required parsers', () => {
    const parseRequiredA = required(parseA, 'Expected a');

    const valid = cursor('a');
    expect(parseRequiredA(valid)).toBe('a');
    expectDone(valid);

    const invalid = cursor('b');
    expect(() => parseRequiredA(invalid)).toThrow('Expected a');
    expect(invalid.pos()).toBe(0);
  });

  it('throws when a repeated parser succeeds without consuming input', () => {
    const parseEmpty: TryValueParser<'empty'> = () => 'empty';

    const c = cursor('a');

    // empty+
    expect(() => repeat(parseEmpty, 1).parse(c)).toThrow('Repeated parser matched without consuming input');
  });

  it('parses exact repetitions', () => {
    const c = cursor('a a b');

    // a{2}
    const parseExactlyTwoA = repeat(parseA, 2, 2);
    const result = parseExactlyTwoA.parse(c);

    expect(result).toEqual(['a', 'a']);
    expectNextIdent(c, 'b');
  });

  it('parses zero exact repetitions', () => {
    const c = cursor('a');

    // a{0}
    const parseExactlyZeroA = repeat(parseA, 0, 0);
    const result = parseExactlyZeroA.parse(c);

    expect(result).toEqual([]);
    expect(c.pos()).toBe(0);
  });

  it('restores after partial repetition when minimum is not met', () => {
    const c = cursor('a b');

    // a{2,3}
    const parseTwoToThreeA = repeat(parseA, 2, 3);

    expect(parseTwoToThreeA.parse(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('leaves repetitions beyond the default supported limit for the caller to reject', () => {
    const css = Array.from({ length: 21 }, () => 'a').join(' ');
    const c = cursor(css);

    // a+
    const parseAPlus = repeat(parseA, 1);
    const result = parseAPlus.parse(c);

    expect(result).toHaveLength(20);
    expectNextIdent(c, 'a');
  });

  it('parses zero-or-more comma repetitions', () => {
    const c = cursor('b');

    // a#?
    const parseOptionalACommaList = repeatComma(parseA, 0);
    const result = parseOptionalACommaList.parse(c);

    expect(result).toEqual([]);
    expect(c.pos()).toBe(0);
  });

  it('restores comma-separated repetitions when minimum is not met', () => {
    const c = cursor('a');

    // a#{2,3}
    const parseTwoToThreeA = repeatComma(parseA, 2, 3);

    expect(parseTwoToThreeA.parse(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('does not parse a comma-separated repetition without a first item', () => {
    const c = cursor(', a');

    // a#
    const parseACommaList = repeatComma(parseA);

    expect(parseACommaList.parse(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('allows whitespace around comma separators', () => {
    const c = cursor('a ,  a');

    // a#
    const parseACommaList = repeatComma(parseA);
    const result = parseACommaList.parse(c);

    expect(result).toEqual(['a', 'a']);
    expectDone(c);
  });

  it('leaves comma repetitions beyond the default supported limit for the caller to reject', () => {
    const css = Array.from({ length: 21 }, () => 'a').join(', ');
    const c = cursor(css);

    // a#
    const parseACommaList = repeatComma(parseA);
    const result = parseACommaList.parse(c);

    expect(result).toHaveLength(20);
    expectNextComma(c);
  });

  it('throws when a comma-repeated parser succeeds without consuming input', () => {
    const parseEmpty: TryValueParser<'empty'> = () => 'empty';

    const c = cursor('a');

    // empty#
    expect(() => repeatComma(parseEmpty).parse(c)).toThrow('Comma repeated parser matched without consuming input');
  });

  it('matches zero or more components in order: A? B? C?', () => {
    // A? B? C?
    const parseZeroOrMoreInOrder = sequence(
      repeat(parseA, 0, 1),
      repeat(parseB, 0, 1),
      repeat(parseC, 0, 1),
      (value) => value,
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
      requiredSequence(
        repeat(parseA, 0, 1),
        repeat(parseB, 0, 1),
        repeat(parseC, 0, 1),
        (value) => value,
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
      (value) => value,
    );

    const valid = cursor('a b c');
    expect(parseAllInOrder(valid)).toEqual([['a'], ['b'], ['c']]);
    expectDone(valid);

    const invalid = cursor('a c');
    expect(parseAllInOrder(invalid)).toBeNull();
    expect(invalid.pos()).toBe(0);
  });

  it('matches zero or more components in any order: A? && B? && C?', () => {
    // A? && B? && C?
    const parseOptionalABC = allOf(
      opt(parseA),
      opt(parseB),
      opt(parseC),
      (value) => value,
    );

    const empty = cursor('');
    expect(parseOptionalABC(empty)).toEqual([
      [],
      [],
      [],
    ]);
    expectDone(empty);

    const reordered = cursor('c a');
    expect(parseOptionalABC(reordered)).toEqual([
      ['a'],
      [],
      ['c'],
    ]);
    expectDone(reordered);
  });

  it('matches one or more components in any order: A || B || C', () => {
    // A || B || C
    const parseOneOrMoreABC = someOf(
      one(parseA),
      one(parseB),
      one(parseC),
      (value) => value,
    );

    const c = cursor('b');
    expect(parseOneOrMoreABC(c)).toEqual([
      undefined,
      ['b'],
      undefined,
    ]);
    expectDone(c);

    const reordered = cursor('c a');
    expect(parseOneOrMoreABC(reordered)).toEqual([
      ['a'],
      undefined,
      ['c'],
    ]);
    expectDone(reordered);

    const empty = cursor('');
    expect(parseOneOrMoreABC(empty)).toBeNull();
    expect(empty.pos()).toBe(0);
  });

  it('matches all components in any order: A && B && C', () => {
    // A && B && C
    const parseAllABC = allOf(
      one(parseA),
      one(parseB),
      one(parseC),
      (value) => value,
    );

    const reordered = cursor('c a b');
    expect(parseAllABC(reordered)).toEqual([
      ['a'],
      ['b'],
      ['c'],
    ]);
    expectDone(reordered);

    const missing = cursor('c a');
    expect(parseAllABC(missing)).toBeNull();
    expect(missing.pos()).toBe(0);
  });

  it('matches zero or more components in any order: A? || B? || C?', () => {
    // A? || B? || C?
    const parseOptionalABC = someOf(
      opt(parseA),
      opt(parseB),
      opt(parseC),
      (value) => value,
    );

    const empty = cursor('');
    expect(parseOptionalABC(empty)).toEqual([
      [],
      [],
      [],
    ]);
    expectDone(empty);

    const reordered = cursor('c a');
    expect(parseOptionalABC(reordered)).toEqual([
      ['a'],
      [],
      ['c'],
    ]);
    expectDone(reordered);
  });

  it('allows comments between juxtaposed components', () => {
    const c = cursor('a/**/b');

    const parseAB = sequence(
      one(parseA),
      one(parseB),
      (value) => value,
    );

    expect(parseAB(c)).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('allows comments around comma separators', () => {
    const c = cursor('a/**/,/**/a');

    const parseACommaList = repeatComma(parseA);

    expect(parseACommaList.parse(c)).toEqual(['a', 'a']);
    expectDone(c);
  });

  it('keeps exclusive alternatives outside unordered groups', () => {
    const parseNone = valueLiteralParser('none');
    const parseUnderline = valueLiteralParser('underline');
    const parseOverline = valueLiteralParser('overline');
    const parseLineThrough = valueLiteralParser('line-through');
    const parseBlink = valueLiteralParser('blink');

    // underline || overline || line-through || blink
    const parseTextDecorationKeywords = someOf(
      one(parseUnderline),
      one(parseOverline),
      one(parseLineThrough),
      one(parseBlink),
      (value) => value,
    );

    // none | underline || overline || line-through || blink
    const parseTextDecorationLine = oneOf(
      one(parseNone),
      one(parseTextDecorationKeywords),
      ([value]) => value,
    );

    // combinator precedence should not allow this to be parsed as
    // (none | underline) || overline || line-through || blink
    // const parseTextDecorationLine_Wrong = someOf(
    //   one(
    //     oneOf(
    //       one(parseNone),
    //       one(parseUnderline),
    //       ([value]) => value,
    //     ),
    //   ),
    //   one(parseOverline),
    //   one(parseLineThrough),
    //   one(parseBlink),
    //   value => value,
    // );

    const none = cursor('none');
    expect(parseTextDecorationLine(none)).toEqual('none');
    expectDone(none);

    const reordered = cursor('overline underline');
    expect(parseTextDecorationLine(reordered)).toEqual([
      ['underline'],
      ['overline'],
      undefined,
      undefined,
    ]);
    expectDone(reordered);

    const invalid = cursor('none overline');
    expect(parseTextDecorationLine(invalid)).toEqual('none');
    expectNextIdent(invalid, 'overline');
  });

});

describe('component grammar trivia ownership', () => {
  const rawA = literalParser('a');
  const rawB = literalParser('b');

  it('keeps sequence tight when parsers are tight', () => {
    const c = cursor('a b');

    const parseAB = sequence(
      one(rawA),
      one(rawB),
      (value) => value,
    );

    expect(parseAB(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('allows value parsers to own leading trivia', () => {
    const c = cursor('a b');

    const parseAB = sequence(
      one(withComponentTrivia(rawA)),
      one(withComponentTrivia(rawB)),
      (value) => value,
    );

    expect(parseAB(c)).toEqual([['a'], ['b']]);
    expectDone(c);
  });
});

describe('selector separator trivia prototype', () => {
  type DemoCombinator = ' ' | '>' | '+' | '~' | '||';

  const parseExplicitCombinator: TryValueParser<DemoCombinator> = (c) => {
    const start = c.pos();
    const first = c.next();

    if (
      first !== null &&
      'kind' in first &&
      first.kind === TokenKind.Delim
    ) {
      switch (first.value) {
        case '>':
        case '+':
        case '~':
          return first.value;

        case '|': {
          const second = c.next();

          if (
            second !== null &&
            'kind' in second &&
            second.kind === TokenKind.Delim &&
            second.value === '|'
          ) {
            return '||';
          }

          c.restore(start);
          return null;
        }
      }
    }

    c.restore(start);
    return null;
  };

  const parseSelectorSeparator: TryValueParser<DemoCombinator> = (c) => {
    const start = c.pos();

    const sawWhitespace = c.match(TokenKind.Whitespace);
    const explicit = parseExplicitCombinator(c);

    if (explicit !== null) {
      consumeComponentTrivia(c);
      return explicit;
    }

    if (sawWhitespace) {
      return ' ';
    }

    c.restore(start);
    return null;
  };

  it('parses whitespace as descendant combinator fallback', () => {
    const c = cursor(' a');

    expect(parseSelectorSeparator(c)).toBe(' ');
    expectNextIdent(c, 'a');
  });

  it('treats whitespace before an explicit combinator as padding', () => {
    const c = cursor(' + a');

    expect(parseSelectorSeparator(c)).toBe('+');
    expectNextIdent(c, 'a');
  });

  it('parses explicit combinator without leading whitespace', () => {
    const c = cursor('+ a');

    expect(parseSelectorSeparator(c)).toBe('+');
    expectNextIdent(c, 'a');
  });

  it('parses column combinator', () => {
    const c = cursor(' || a');

    expect(parseSelectorSeparator(c)).toBe('||');
    expectNextIdent(c, 'a');
  });

  it('does not invent a separator without whitespace or explicit combinator', () => {
    const c = cursor('a');

    expect(parseSelectorSeparator(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('requires at least one value in unordered all-of groups', () => {
    // [ a? && b? ]!
    const parseOneOrMoreAB = requiredAllOf(
      opt(parseA),
      opt(parseB),
      (value) => value,
    );

    const empty = cursor('');
    expect(parseOneOrMoreAB(empty)).toBeNull();
    expect(empty.pos()).toBe(0);

    const valid = cursor('b');
    expect(parseOneOrMoreAB(valid)).toEqual([
      [],
      ['b'],
    ]);
    expectDone(valid);

    const reordered = cursor('b a');
    expect(parseOneOrMoreAB(reordered)).toEqual([
      ['a'],
      ['b'],
    ]);
    expectDone(reordered);
  });

  it('requires at least one multiplier value without throwing', () => {
    // [ a? b? ]!
    const parseOneOrMoreAB = requiredSequence(
      repeat(parseA, 0, 1),
      repeat(parseB, 0, 1),
      (value) => value,
    );

    const empty = cursor('');
    expect(parseOneOrMoreAB(empty)).toBeNull();
    expect(empty.pos()).toBe(0);

    const valid = cursor('b');
    expect(parseOneOrMoreAB(valid)).toEqual([[], ['b']]);
    expectDone(valid);
  });

  it('restores when requiredSequence sees only empty multiplier values', () => {
    // [ a? b? ]!
    const parseOneOrMoreAB = requiredSequence(
      repeat(parseA, 0, 1),
      repeat(parseB, 0, 1),
      (value) => value,
    );

    const c = cursor('c');

    expect(parseOneOrMoreAB(c)).toBeNull();
    expect(c.pos()).toBe(0);
    expectNextIdent(c, 'c');
  });

  it('treats non-empty nested unordered values as present in requiredSomeOf', () => {
    // [ a? || b? ]!
    const parseAOrB = requiredSomeOf(
      opt(parseA),
      opt(parseB),
      (value) => value,
    );

    const empty = cursor('');
    expect(parseAOrB(empty)).toBeNull();
    expect(empty.pos()).toBe(0);

    const valid = cursor('a');
    expect(parseAOrB(valid)).toEqual([
      ['a'],
      [],
    ]);
    expectDone(valid);
  });

  // it('backtracks optional repetition when a later required component needs the token', () => {
  //   // a? a
  //   const parseMaybeAThenA = sequence(
  //     opt(parseA),
  //     one(parseA),
  //   );

  //   const c = cursor('a');

  //   expect(parseMaybeAThenA(c)).toEqual([[], ['a']]);
  //   expectDone(c);
  // });

  // it('backtracks greedy repetition when a later required component needs a token', () => {
  //   // a* a b*
  //   const parseAStarThenAThenBStar = sequence(
  //     any(parseA),
  //     one(parseA),
  //     any(parseB),
  //   );

  //   const c = cursor('a a b b');

  //   expect(parseAStarThenAThenBStar(c)).toEqual([
  //     ['a'],
  //     ['a'],
  //     ['b', 'b'],
  //   ]);
  //   expectDone(c);
  // });
});
