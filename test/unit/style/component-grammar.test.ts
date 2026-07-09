import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../src/stylelet/parser/component-cursor';
import { consumeComponentTrivia, isIdentToken, parseAsComponentGrammar, parseListAsComponentGrammar, parseListOfComponentValues } from '../../../src/stylelet/parser/syntax';
import { TokenKind } from '../../../src/stylelet/parser/tokens';
import {
  __nextSequenceCaps, __parseSequenceAttempt,
  allOf, any, commaRepeat, one, oneOf, opt, plus, repeat, required, requiredAllOf, requiredSequenceOf,
  requiredSomeOf, sequenceOf, someOf, withComponentTrivia,
} from '../../../src/stylelet/parser/component-grammar';
import {
  bad,
  ComponentParserBadReason,
  isBad, ok, unwrapParseResultOrThrow, type ComponentParserBad, type TryComponentParser, type TryComponentParserResult,
} from '../../../src/stylelet/parser/component-try-parser';

const cursor = (css: string, context: unknown = undefined): ComponentCursor =>
  new ComponentCursor(parseListOfComponentValues(css), { context });

const literalParser = <T extends string>(expected: T): TryComponentParser<T> => {
  return (c: ComponentCursor): TryComponentParserResult<T> => {
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

    return ok(expected);
  };
};

const valueLiteralParser = <T extends string>(expected: T): TryComponentParser<T> =>
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

const unwrap = <T>(result: TryComponentParserResult<T>): T | null =>
  unwrapParseResultOrThrow(result, 'component grammar test result');

type SequenceAttemptValue =
  Exclude<ReturnType<typeof __parseSequenceAttempt>, ComponentParserBad>;

function expectSequenceAttempt(
  attempt: ReturnType<typeof __parseSequenceAttempt>,
): SequenceAttemptValue {
  if (isBad(attempt)) {
    throw new Error(`Unexpected bad sequence attempt: ${attempt.message ?? attempt.reason}`);
  }

  return attempt;
}

const badAfterA = (message = 'bad test parser'): TryComponentParser<'bad'> => {
  return (c) => {
    const value = unwrapParseResultOrThrow(parseA(c), 'bad test prefix');

    if (value === null) {
      return null;
    }

    return bad(ComponentParserBadReason.Invalid, message);
  };
};

describe('component value combinators', () => {
  it('parses unordered all-of components in grammar order', () => {
    const c = cursor('a b');

    // a && b
    const parseAAndB = allOf(
      [
        one(parseA),
        one(parseB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(parseAAndB(c))).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('parses unordered all-of components in swapped order', () => {
    const c = cursor('b a');

    // a && b
    const parseAAndB = allOf(
      [
        one(parseA),
        one(parseB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(parseAAndB(c))).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('allows optional components in unordered all-of groups', () => {
    const c = cursor('a');

    // a && b?
    const parseAAndMaybeB = allOf(
      [
        one(parseA),
        opt(parseB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(parseAAndMaybeB(c))).toEqual([['a'], []]);
    expectDone(c);
  });

  it('parses optional components before required components', () => {
    const c = cursor('b a');

    // a && b?
    const parseAAndMaybeB = allOf(
      [
        one(parseA),
        opt(parseB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(parseAAndMaybeB(c))).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('returns null when required unordered all-of components are missing', () => {
    const c = cursor('b');

    // a && b?
    const parseAAndMaybeB = allOf(
      [
        one(parseA),
        opt(parseB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(parseAAndMaybeB(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('parses unordered some-of components with one match', () => {
    const c = cursor('a');

    // a || b
    const parseAOrBOrBoth = someOf(
      [
        one(parseA),
        one(parseB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(parseAOrBOrBoth(c))).toEqual([['a'], undefined]);
    expectDone(c);
  });

  it('parses unordered some-of components with multiple matches in any order', () => {
    const c = cursor('b a');

    // a || b
    const parseAOrBOrBoth = someOf(
      [
        one(parseA),
        one(parseB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(parseAOrBOrBoth(c))).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('returns null when unordered some-of components do not match', () => {
    const c = cursor('d');

    // a || b
    const parseAOrBOrBoth = someOf(
      [
        one(parseA),
        one(parseB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(parseAOrBOrBoth(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('leaves duplicate components for the caller to reject', () => {
    const c = cursor('a a');

    // a || b
    const parseAOrBOrBoth = someOf(
      [
        one(parseA),
        one(parseB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(parseAOrBOrBoth(c))).toEqual([['a'], undefined]);
    expectNextIdent(c, 'a');
  });

  it('does not interleave inside grouped components', () => {
    const groupedBC: TryComponentParser<readonly ['b', 'c']> = (c: ComponentCursor) => {
      const start = c.pos();

      const bv = unwrapParseResultOrThrow(parseB(c), 'grouped b');

      if (bv === null) {
        c.restore(start);
        return null;
      }

      consumeComponentTrivia(c);

      const cv = unwrapParseResultOrThrow(parseC(c), 'grouped c');

      if (cv === null) {
        c.restore(start);
        return null;
      }

      return ok([bv, cv]);
    };

    // a || [ b c ]
    const parseAOrGroupedBCOrBoth = someOf(
      [
        one(parseA),
        one(groupedBC),
      ],
      (value) => ok(value),
    );

    const valid = cursor('a b c');

    expect(unwrap(parseAOrGroupedBCOrBoth(valid))).toEqual([
      ['a'],
      [['b', 'c']],
    ]);

    expectDone(valid);

    const invalid = cursor('b a c');

    expect(unwrap(parseAOrGroupedBCOrBoth(invalid))).toBeNull();
    expect(invalid.pos()).toBe(0);
  });

  it('parses juxtaposed components with sequence', () => {
    const c = cursor('a b');

    const parseAB = sequenceOf(
      [
        one(parseA),
        one(parseB),
      ],
      (value) => ok(value),
    );

    const result = parseAB(c);

    expect(unwrap(result)).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('parses alternatives with oneOf', () => {
    const c = cursor('b');

    const parseAOrB = oneOf(
      [
        one(parseA),
        one(parseB),
      ],
      (value) => ok(value),
    );

    const result = parseAOrB(c);

    expect(unwrap(result)).toEqual(['b']);
    expectDone(c);
  });

  it('returns null from oneOf when no alternatives match', () => {
    const c = cursor('c');

    const parseAOrB = oneOf(
      [
        one(parseA),
        one(parseB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(parseAOrB(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  // a b | c || d && e f
  it('composes grammar combinator precedence', () => {
    const parseD = valueLiteralParser('d');
    const parseE = valueLiteralParser('e');
    const parseF = valueLiteralParser('f');

    // a b
    const parseAB = sequenceOf(
      [
        one(parseA),
        one(parseB),
      ],
      (value) => ok(value),
    );

    // e f
    const parseEF = sequenceOf(
      [
        one(parseE),
        one(parseF),
      ],
      (value) => ok(value),
    );

    // d && e f
    const parseDAndEF = allOf(
      [
        one(parseD),
        one(parseEF),
      ],
      ([d, ef]) => ok([
        d,
        ef![0],
      ]),
    );

    // c || d && e f
    const parseCOrDAndEF = someOf(
      [
        one(parseC),
        one(parseDAndEF),
      ],
      ([c, dAndEF]) => ok([
        c,
        dAndEF?.[0],
      ]),
    );

    // a b | c || d && e f
    const parseWhole = oneOf(
      [
        one(parseAB),
        one(parseCOrDAndEF),
      ],
      ([value]) => ok(value),
    );

    const ab = cursor('a b');
    expect(unwrap(parseWhole(ab))).toEqual([['a'], ['b']]);
    expectDone(ab);

    const reordered = cursor('e f d c');
    expect(unwrap(parseWhole(reordered))).toEqual([
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
    expect(unwrap(parseWhole(partial))).toEqual([
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
    const result = parseAStar(c);

    expect(unwrap(result)).toEqual([]);
    expect(c.pos()).toBe(0);
  });

  it('parses one-or-more repetitions', () => {
    const c = cursor('a a b');

    // a+
    const parseAPlus = repeat(parseA, 1);
    const result = parseAPlus(c);

    expect(unwrap(result)).toEqual(['a', 'a']);

    expectNextIdent(c, 'b');
  });

  it('parses bounded repetitions', () => {
    const c = cursor('a a a a');

    // a{1,3}
    const parseOneToThreeA = repeat(parseA, 1, 3);
    const result = parseOneToThreeA(c);

    expect(unwrap(result)).toEqual(['a', 'a', 'a']);
    expectNextIdent(c, 'a');
  });

  it('returns null when repetition minimum is not met', () => {
    const c = cursor('a');

    // a{2,3}
    const parseTwoToThreeA = repeat(parseA, 2, 3);

    expect(unwrap(parseTwoToThreeA(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('uses zero-to-one repetition as an optional component in sequence', () => {
    // a? b
    const parseMaybeAThenB = sequenceOf(
      [
        repeat(parseA, 0, 1),
        one(parseB),
      ],
      (value) => ok(value),
    );

    const withA = cursor('a b');
    expect(unwrap(parseMaybeAThenB(withA))).toEqual([['a'], ['b']]);
    expectDone(withA);

    const withoutA = cursor('b');
    expect(unwrap(parseMaybeAThenB(withoutA))).toEqual([[], ['b']]);
    expectDone(withoutA);
  });

  it('parses comma-separated repetitions', () => {
    const c = cursor('a, a, a');

    // a#
    const parseACommaList = commaRepeat(parseA);
    const result = parseACommaList(c);

    expect(unwrap(result)).toEqual(['a', 'a', 'a']);
    expectDone(c);
  });

  it('parses bounded comma-separated repetitions', () => {
    const c = cursor('a, a, a');

    // a#{1,2}
    const parseOneToTwoA = commaRepeat(parseA, 1, 2);
    const result = parseOneToTwoA(c);

    expect(unwrap(result)).toEqual(['a', 'a']);
    expectNextComma(c);
  });

  it('leaves trailing comma for the caller to reject', () => {
    const c = cursor('a,');

    // a#
    const parseACommaList = commaRepeat(parseA);
    const result = parseACommaList(c);

    expect(unwrap(result)).toEqual(['a']);
    expectNextComma(c);
  });

  it('returns null when comma-separated repetition minimum is not met', () => {
    const c = cursor('b');

    // a#
    const parseACommaList = commaRepeat(parseA);

    expect(unwrap(parseACommaList(c))).toBeNull();
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

  it('throws when a repeat parser succeeds without consuming input', () => {
    const parseEmpty: TryComponentParser<'empty'> = () => ok('empty');

    const c = cursor('a');

    // empty+
    expect(() => plus(parseEmpty)(c)).toThrow('Repeated parser matched without consuming input');
  });

  it('parses exact repetitions', () => {
    const c = cursor('a a b');

    // a{2}
    const parseExactlyTwoA = repeat(parseA, 2, 2);
    const result = parseExactlyTwoA(c);

    expect(unwrap(result)).toEqual(['a', 'a']);
    expectNextIdent(c, 'b');
  });

  it('parses zero exact repetitions', () => {
    const c = cursor('a');

    // a{0}
    const parseExactlyZeroA = repeat(parseA, 0, 0);
    const result = parseExactlyZeroA(c);

    expect(unwrap(result)).toEqual([]);
    expect(c.pos()).toBe(0);
  });

  it('restores after partial repetition when minimum is not met', () => {
    const c = cursor('a b');

    // a{2,3}
    const parseTwoToThreeA = repeat(parseA, 2, 3);

    expect(unwrap(parseTwoToThreeA(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('leaves repetitions beyond the default supported limit for the caller to reject', () => {
    const css = Array.from({ length: 21 }, () => 'a').join(' ');
    const c = cursor(css);

    // a+
    const parseAPlus = repeat(parseA, 1);
    const result = parseAPlus(c);

    expect(unwrap(result)).toHaveLength(20);
    expectNextIdent(c, 'a');
  });

  it('parses zero-or-more comma repetitions', () => {
    const c = cursor('b');

    // a#?
    const parseOptionalACommaList = commaRepeat(parseA, 0);
    const result = parseOptionalACommaList(c);

    expect(unwrap(result)).toEqual([]);
    expect(c.pos()).toBe(0);
  });

  it('restores comma-separated repetitions when minimum is not met', () => {
    const c = cursor('a');

    // a#{2,3}
    const parseTwoToThreeA = commaRepeat(parseA, 2, 3);

    expect(unwrap(parseTwoToThreeA(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('does not parse a comma-separated repetition without a first item', () => {
    const c = cursor(', a');

    // a#
    const parseACommaList = commaRepeat(parseA);

    expect(unwrap(parseACommaList(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('allows whitespace around comma separators', () => {
    const c = cursor('a ,  a');

    // a#
    const parseACommaList = commaRepeat(parseA);
    const result = parseACommaList(c);

    expect(unwrap(result)).toEqual(['a', 'a']);
    expectDone(c);
  });

  it('leaves comma repetitions beyond the default supported limit for the caller to reject', () => {
    const css = Array.from({ length: 21 }, () => 'a').join(', ');
    const c = cursor(css);

    // a#
    const parseACommaList = commaRepeat(parseA);
    const result = parseACommaList(c);

    expect(unwrap(result)).toHaveLength(20);
    expectNextComma(c);
  });

  it('throws when a comma-repeat parser succeeds without consuming input', () => {
    const parseEmpty: TryComponentParser<'empty'> = () => ok('empty');

    const c = cursor('a');

    // empty#
    expect(() => commaRepeat(parseEmpty)(c)).toThrow('Comma repeat matched without consuming input');
  });

  it('matches zero or more components in order: A? B? C?', () => {
    // A? B? C?
    const parseZeroOrMoreInOrder = sequenceOf(
      [
        repeat(parseA, 0, 1),
        repeat(parseB, 0, 1),
        repeat(parseC, 0, 1),
      ],
      (value) => ok(value),
    );

    const empty = cursor('');
    expect(unwrap(parseZeroOrMoreInOrder(empty))).toEqual([[], [], []]);
    expectDone(empty);

    const sparse = cursor('a c');
    expect(unwrap(parseZeroOrMoreInOrder(sparse))).toEqual([['a'], [], ['c']]);
    expectDone(sparse);
  });

  it('matches one or more components in order: [ A? B? C? ]!', () => {
    // [ A? B? C? ]!
    const parseOneOrMoreInOrder = required(
      requiredSequenceOf(
        [
          repeat(parseA, 0, 1),
          repeat(parseB, 0, 1),
          repeat(parseC, 0, 1),
        ],
        (value) => ok(value),
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
    const parseAllInOrder = sequenceOf(
      [
        one(parseA),
        one(parseB),
        one(parseC),
      ],
      (value) => ok(value),
    );

    const valid = cursor('a b c');
    expect(unwrap(parseAllInOrder(valid))).toEqual([['a'], ['b'], ['c']]);
    expectDone(valid);

    const invalid = cursor('a c');
    expect(unwrap(parseAllInOrder(invalid))).toBeNull();
    expect(invalid.pos()).toBe(0);
  });

  it('matches zero or more components in any order: A? && B? && C?', () => {
    // A? && B? && C?
    const parseOptionalABC = allOf(
      [
        opt(parseA),
        opt(parseB),
        opt(parseC),
      ],
      (value) => ok(value),
    );

    const empty = cursor('');
    expect(unwrap(parseOptionalABC(empty))).toEqual([
      [],
      [],
      [],
    ]);
    expectDone(empty);

    const reordered = cursor('c a');
    expect(unwrap(parseOptionalABC(reordered))).toEqual([
      ['a'],
      [],
      ['c'],
    ]);
    expectDone(reordered);
  });

  it('matches one or more components in any order: A || B || C', () => {
    // A || B || C
    const parseOneOrMoreABC = someOf(
      [
        one(parseA),
        one(parseB),
        one(parseC),
      ],
      (value) => ok(value),
    );

    const c = cursor('b');
    expect(unwrap(parseOneOrMoreABC(c))).toEqual([
      undefined,
      ['b'],
      undefined,
    ]);
    expectDone(c);

    const reordered = cursor('c a');
    expect(unwrap(parseOneOrMoreABC(reordered))).toEqual([
      ['a'],
      undefined,
      ['c'],
    ]);
    expectDone(reordered);

    const empty = cursor('');
    expect(unwrap(parseOneOrMoreABC(empty))).toBeNull();
    expect(empty.pos()).toBe(0);
  });

  it('matches all components in any order: A && B && C', () => {
    // A && B && C
    const parseAllABC = allOf(
      [
        one(parseA),
        one(parseB),
        one(parseC),
      ],
      (value) => ok(value),
    );

    const reordered = cursor('c a b');
    expect(unwrap(parseAllABC(reordered))).toEqual([
      ['a'],
      ['b'],
      ['c'],
    ]);
    expectDone(reordered);

    const missing = cursor('c a');
    expect(unwrap(parseAllABC(missing))).toBeNull();
    expect(missing.pos()).toBe(0);
  });

  it('matches zero or more components in any order: A? || B? || C?', () => {
    // A? || B? || C?
    const parseOptionalABC = someOf(
      [
        opt(parseA),
        opt(parseB),
        opt(parseC),
      ],
      (value) => ok(value),
    );

    const empty = cursor('');
    expect(unwrap(parseOptionalABC(empty))).toEqual([
      [],
      [],
      [],
    ]);
    expectDone(empty);

    const reordered = cursor('c a');
    expect(unwrap(parseOptionalABC(reordered))).toEqual([
      ['a'],
      [],
      ['c'],
    ]);
    expectDone(reordered);
  });

  it('allows comments between juxtaposed components', () => {
    const c = cursor('a/**/b');

    const parseAB = sequenceOf(
      [
        one(parseA),
        one(parseB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(parseAB(c))).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('allows comments around comma separators', () => {
    const c = cursor('a/**/,/**/a');

    const parseACommaList = commaRepeat(parseA);

    expect(unwrap(parseACommaList(c))).toEqual(['a', 'a']);
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
      [
        one(parseUnderline),
        one(parseOverline),
        one(parseLineThrough),
        one(parseBlink),
      ],
      (value) => ok(value),
    );

    // none | underline || overline || line-through || blink
    const parseTextDecorationLine = oneOf(
      [
        one(parseNone),
        one(parseTextDecorationKeywords),
      ],
      ([value]) => ok(value),
    );

    // combinator precedence should not allow this to be parsed as
    // (none | underline) || overline || line-through || blink
    // const parseTextDecorationLine_Wrong = someOf(
    //   one(
    //     oneOf(
    //       one(parseNone),
    //       one(parseUnderline),
    //       ([value]) => ok(value),
    //     ),
    //   ),
    //   one(parseOverline),
    //   one(parseLineThrough),
    //   one(parseBlink),
    //   value => value,
    // );

    const none = cursor('none');
    expect(unwrap(parseTextDecorationLine(none))).toEqual('none');
    expectDone(none);

    const reordered = cursor('overline underline');
    expect(unwrap(parseTextDecorationLine(reordered))).toEqual([
      ['underline'],
      ['overline'],
      undefined,
      undefined,
    ]);
    expectDone(reordered);

    const invalid = cursor('none overline');
    expect(unwrap(parseTextDecorationLine(invalid))).toEqual('none');
    expectNextIdent(invalid, 'overline');
  });

});

describe('component grammar trivia ownership', () => {
  const rawA = literalParser('a');
  const rawB = literalParser('b');

  it('keeps sequence tight when parsers are tight', () => {
    const c = cursor('a b');

    const parseAB = sequenceOf(
      [
        one(rawA),
        one(rawB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(parseAB(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('allows value parsers to own leading trivia', () => {
    const c = cursor('a b');

    const parseAB = sequenceOf(
      [
        one(withComponentTrivia(rawA)),
        one(withComponentTrivia(rawB)),
      ],
      (value) => ok(value),
    );

    expect(unwrap(parseAB(c))).toEqual([['a'], ['b']]);
    expectDone(c);
  });
});

describe('selector separator trivia prototype', () => {
  type DemoCombinator = ' ' | '>' | '+' | '~' | '||';

  const parseExplicitCombinator: TryComponentParser<DemoCombinator> = (c) => {
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
          return ok(first.value);

        case '|': {
          const second = c.next();

          if (
            second !== null &&
            'kind' in second &&
            second.kind === TokenKind.Delim &&
            second.value === '|'
          ) {
            return ok('||');
          }

          c.restore(start);
          return null;
        }
      }
    }

    c.restore(start);
    return null;
  };

  const parseSelectorSeparator: TryComponentParser<DemoCombinator> = (c) => {
    const start = c.pos();

    const sawWhitespace = c.match(TokenKind.Whitespace);
    const explicit = unwrapParseResultOrThrow(
      parseExplicitCombinator(c),
      'explicit combinator',
    );

    if (explicit !== null) {
      consumeComponentTrivia(c);
      return ok(explicit);
    }

    if (sawWhitespace) {
      return ok(' ');
    }

    c.restore(start);
    return null;
  };

  it('parses whitespace as descendant combinator fallback', () => {
    const c = cursor(' a');

    expect(unwrap(parseSelectorSeparator(c))).toBe(' ');
    expectNextIdent(c, 'a');
  });

  it('treats whitespace before an explicit combinator as padding', () => {
    const c = cursor(' + a');

    expect(unwrap(parseSelectorSeparator(c))).toBe('+');
    expectNextIdent(c, 'a');
  });

  it('parses explicit combinator without leading whitespace', () => {
    const c = cursor('+ a');

    expect(unwrap(parseSelectorSeparator(c))).toBe('+');
    expectNextIdent(c, 'a');
  });

  it('parses column combinator', () => {
    const c = cursor(' || a');

    expect(unwrap(parseSelectorSeparator(c))).toBe('||');
    expectNextIdent(c, 'a');
  });

  it('does not invent a separator without whitespace or explicit combinator', () => {
    const c = cursor('a');

    expect(unwrap(parseSelectorSeparator(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('requires at least one value in unordered all-of groups', () => {
    // [ a? && b? ]!
    const parseOneOrMoreAB = requiredAllOf(
      [
        opt(parseA),
        opt(parseB),
      ],
      (value) => ok(value),
    );

    const empty = cursor('');
    expect(unwrap(parseOneOrMoreAB(empty))).toBeNull();
    expect(empty.pos()).toBe(0);

    const valid = cursor('b');
    expect(unwrap(parseOneOrMoreAB(valid))).toEqual([
      [],
      ['b'],
    ]);
    expectDone(valid);

    const reordered = cursor('b a');
    expect(unwrap(parseOneOrMoreAB(reordered))).toEqual([
      ['a'],
      ['b'],
    ]);
    expectDone(reordered);
  });

  it('requires at least one multiplier value without throwing', () => {
    // [ a? b? ]!
    const parseOneOrMoreAB = requiredSequenceOf(
      [
        repeat(parseA, 0, 1),
        repeat(parseB, 0, 1),
      ],
      (value) => ok(value),
    );

    const empty = cursor('');
    expect(unwrap(parseOneOrMoreAB(empty))).toBeNull();
    expect(empty.pos()).toBe(0);

    const valid = cursor('b');
    expect(unwrap(parseOneOrMoreAB(valid))).toEqual([[], ['b']]);
    expectDone(valid);
  });

  it('restores when requiredSequence sees only empty multiplier values', () => {
    // [ a? b? ]!
    const parseOneOrMoreAB = requiredSequenceOf(
      [
        repeat(parseA, 0, 1),
        repeat(parseB, 0, 1),
      ],
      (value) => ok(value),
    );

    const c = cursor('c');

    expect(unwrap(parseOneOrMoreAB(c))).toBeNull();
    expect(c.pos()).toBe(0);
    expectNextIdent(c, 'c');
  });

  it('treats non-empty nested unordered values as present in requiredSomeOf', () => {
    // [ a? || b? ]!
    const parseAOrB = requiredSomeOf(
      [
        opt(parseA),
        opt(parseB),
      ],
      (value) => ok(value),
    );

    const empty = cursor('');
    expect(unwrap(parseAOrB(empty))).toBeNull();
    expect(empty.pos()).toBe(0);

    const valid = cursor('a');
    expect(unwrap(parseAOrB(valid))).toEqual([
      ['a'],
      [],
    ]);
    expectDone(valid);
  });

  it('backtracks optional repetition when a later required component needs the token', () => {
    // a? a
    const parseMaybeAThenA = sequenceOf(
      [
        opt(parseA),
        one(parseA),
      ],
      (value) => ok(value)
    );

    const c = cursor('a');

    expect(unwrap(parseMaybeAThenA(c))).toEqual([[], ['a']]);
    expectDone(c);
  });

  it('backtracks greedy repetition when a later required component needs a token', () => {
    // a* a b*
    const parseAStarThenAThenBStar = sequenceOf(
      [
        any(parseA),
        one(parseA),
        any(parseB),
      ],
      (value) => ok(value)
    );

    const c = cursor('a a b b');

    expect(unwrap(parseAStarThenAThenBStar(c))).toEqual([
      ['a'],
      ['a'],
      ['b', 'b'],
    ]);
    expectDone(c);
  });
});

describe('component sequence backtracking support', () => {
  const parseAB = oneOf(
    [
      one(parseA),
      one(parseB),
    ],
    ([value]) => ok(value),
  );

  const frameCounts = (attempt: {
    frames: { values: unknown[]; }[];
  }) => attempt.frames.map((frame) => frame.values.length);

  it('records actual greedy counts under fixed caps', () => {
    const c = cursor('a a a b');

    const attempt = expectSequenceAttempt(__parseSequenceAttempt(
      c,
      [
        repeat(parseA, 0, 5),
        one(parseB),
      ],
      [
        5,
        1,
      ],
    ));

    expect(attempt.matched).toBe(true);
    expect(attempt.values).toEqual([
      ['a', 'a', 'a'],
      ['b'],
    ]);
    expect(frameCounts(attempt)).toEqual([
      3,
      1,
    ]);
    expectDone(c);
  });

  it('returns successful prefix frames when a later slot fails', () => {
    const c = cursor('a a a c');

    const attempt = expectSequenceAttempt(__parseSequenceAttempt(
      c,
      [
        repeat(parseA, 0, 5),
        one(parseB),
      ],
      [
        5,
        1,
      ],
    ));

    expect(attempt.matched).toBe(false);
    expect(attempt.values).toEqual([
      ['a', 'a', 'a'],
    ]);
    expect(frameCounts(attempt)).toEqual([
      3,
    ]);

    // The failed slot restores to its own start, not to the sequence start.
    expectNextIdent(c, 'c');
  });

  it('uses caps as upper bounds for each slot', () => {
    const c = cursor('a a a b');

    const attempt = expectSequenceAttempt(__parseSequenceAttempt(
      c,
      [
        repeat(parseA, 0, 2),
        one(parseA),
        one(parseB),
      ],
      [
        2,
        1,
        1,
      ],
    ));

    expect(attempt.matched).toBe(true);
    expect(attempt.values).toEqual([
      ['a', 'a'],
      ['a'],
      ['b'],
    ]);
    expect(frameCounts(attempt)).toEqual([
      2,
      1,
      1,
    ]);
    expectDone(c);
  });

  it('allows a reduced cap to expose input to the suffix', () => {
    const c = cursor('a a b');

    const attempt = expectSequenceAttempt(__parseSequenceAttempt(
      c,
      [
        repeat(parseA, 0, 1),
        one(parseA),
        one(parseB),
      ],
      [
        1,
        1,
        1,
      ],
    ));

    expect(attempt.matched).toBe(true);
    expect(attempt.values).toEqual([
      ['a'],
      ['a'],
      ['b'],
    ]);
    expectDone(c);
  });

  it('honors zero caps without consuming input', () => {
    const c = cursor('a b');

    const attempt = expectSequenceAttempt(__parseSequenceAttempt(
      c,
      [
        repeat(parseA, 0, 1),
        one(parseA),
        one(parseB),
      ],
      [
        0,
        1,
        1,
      ],
    ));

    expect(attempt.matched).toBe(true);
    expect(attempt.values).toEqual([
      [],
      ['a'],
      ['b'],
    ]);
    expect(frameCounts(attempt)).toEqual([
      0,
      1,
      1,
    ]);
    expectDone(c);
  });

  it('returns no frame for a first-slot failure', () => {
    const c = cursor('b');

    const attempt = expectSequenceAttempt(__parseSequenceAttempt(
      c,
      [
        one(parseA),
        one(parseB),
      ],
      [
        1,
        1,
      ],
    ));

    expect(attempt.matched).toBe(false);
    expect(attempt.values).toEqual([]);
    expect(attempt.frames).toEqual([]);
    expect(c.pos()).toBe(0);
    expectNextIdent(c, 'b');
  });

  it('records that a greedy ambiguous slot consumed input needed by the suffix', () => {
    const c = cursor('a a a b');

    const attempt = expectSequenceAttempt(__parseSequenceAttempt(
      c,
      [
        repeat(parseAB, 0, 20),
        one(parseB),
      ],
      [
        20,
        1,
      ],
    ));

    expect(attempt.matched).toBe(false);
    expect(attempt.values).toEqual([
      ['a', 'a', 'a', 'b'],
    ]);
    expect(frameCounts(attempt)).toEqual([
      4,
    ]);

    // The failing B slot started at EOF, so the attempt should leave us there.
    expectDone(c);
  });

  it('can expose suffix input when the ambiguous slot cap is reduced', () => {
    const c = cursor('a a a b');

    const attempt = expectSequenceAttempt(__parseSequenceAttempt(
      c,
      [
        repeat(parseAB, 0, 20),
        one(parseB),
      ],
      [
        3,
        1,
      ],
    ));

    expect(attempt.matched).toBe(true);
    expect(attempt.values).toEqual([
      ['a', 'a', 'a'],
      ['b'],
    ]);
    expect(frameCounts(attempt)).toEqual([
      3,
      1,
    ]);
    expectDone(c);
  });

  it('clamps actual count below an oversized cap', () => {
    const c = cursor('a a b');

    const attempt = expectSequenceAttempt(__parseSequenceAttempt(
      c,
      [
        repeat(parseA, 0, 20),
        one(parseB),
      ],
      [
        20,
        1,
      ],
    ));

    expect(attempt.matched).toBe(true);
    expect(attempt.values).toEqual([
      ['a', 'a'],
      ['b'],
    ]);
    expect(frameCounts(attempt)).toEqual([
      2,
      1,
    ]);
    expectDone(c);
  });

  it('returns all successful prefix frames when a later slot fails', () => {
    const c = cursor('a a b c');

    const attempt = expectSequenceAttempt(__parseSequenceAttempt(
      c,
      [
        repeat(parseA, 0, 20),
        one(parseB),
        one(parseB),
      ],
      [
        20,
        1,
        1,
      ],
    ));

    expect(attempt.matched).toBe(false);
    expect(attempt.values).toEqual([
      ['a', 'a'],
      ['b'],
    ]);
    expect(frameCounts(attempt)).toEqual([
      2,
      1,
    ]);

    expectNextIdent(c, 'c');
  });

  it('backtracks an optional prefix when the required suffix needs its input', () => {
    const c = cursor('a b');

    const parse = sequenceOf(
      [
        opt(parseAB),
        one(parseA),
        one(parseB),
      ],
      ([prefix, name, suffix]) => ok({
        prefix,
        name,
        suffix,
      }),
    );

    expect(unwrap(parse(c))).toEqual({
      prefix: [],
      name: ['a'],
      suffix: ['b'],
    });
    expectDone(c);
  });

  it('does not backtrack into a parser that closes over its own multiplier', () => {
    const parseAorB = oneOf(
      [
        one(parseA),
        one(parseB),
      ],
      ([value]) => ok(value),
    );

    const parseAB: TryComponentParser<string[]> = any(parseAorB);

    const parse = sequenceOf(
      [
        one(parseAB),
        one(parseB),
        one(parseB),
      ],
      (value) => ok(value),
    );

    const c = cursor('a b b');

    expect(unwrap(parse(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('backtracks a direct greedy multiplier slot', () => {
    const parseAorB = oneOf(
      [
        one(parseA),
        one(parseB),
      ],
      ([value]) => ok(value),
    );

    const parse = sequenceOf(
      [
        any(parseAorB),
        one(parseB),
        one(parseB),
      ],
      (value) => ok(value),
    );

    const c = cursor('a b b');

    expect(unwrap(parse(c))).toEqual([
      ['a'],
      ['b'],
      ['b'],
    ]);
    expectDone(c);
  });

});

describe('component sequence backtracking caps', () => {
  const framesWithCounts = (...counts: number[]) => counts.map((count) => ({
    start: 0,
    values: Array.from({ length: count }, (_, index) => index),
  }));

  it('decrements the rightmost reducible actual count', () => {
    const caps = __nextSequenceCaps(
      [
        repeat(parseA, 0, 5),
        repeat(parseA, 0, 5),
        repeat(parseA, 0, 20),
        one(parseB),
      ],
      framesWithCounts(3, 1, 6),
    );

    expect(caps).toEqual([
      3,
      1,
      5,
      1,
    ]);
  });

  it('skips a slot that is already at minimum', () => {
    const caps = __nextSequenceCaps(
      [
        repeat(parseA, 0, 5),
        repeat(parseA, 0, 5),
        repeat(parseA, 0, 20),
        one(parseB),
      ],
      framesWithCounts(3, 1, 0),
    );

    expect(caps).toEqual([
      3,
      0,
      20,
      1,
    ]);
  });

  it('resets suffix slots to declared max after decrementing an earlier slot', () => {
    const caps = __nextSequenceCaps(
      [
        repeat(parseA, 0, 5),
        repeat(parseA, 0, 5),
        repeat(parseA, 0, 20),
        one(parseB),
      ],
      framesWithCounts(3, 0, 0),
    );

    expect(caps).toEqual([
      2,
      5,
      20,
      1,
    ]);
  });

  it('respects non-zero minimums', () => {
    const caps = __nextSequenceCaps(
      [
        repeat(parseA, 4, 9),
        repeat(parseA, 2, 5),
        repeat(parseA, 0, 20),
      ],
      framesWithCounts(7, 2, 0),
    );

    expect(caps).toEqual([
      6,
      5,
      20,
    ]);
  });

  it('returns null when no slot can be reduced', () => {
    const caps = __nextSequenceCaps(
      [
        repeat(parseA, 2, 5),
        repeat(parseA, 1, 5),
        repeat(parseA, 0, 20),
      ],
      framesWithCounts(2, 1, 0),
    );

    expect(caps).toBeNull();
  });

  it('returns null when the first slot failed before producing frames', () => {
    const caps = __nextSequenceCaps(
      [
        one(parseA),
        one(parseB),
      ],
      [],
    );

    expect(caps).toBeNull();
  });
});

describe('component combinator null projections', () => {
  it('treats a null sequence projection as parser failure', () => {
    const c = cursor('a');

    const parse = sequenceOf(
      [one(parseA)],
      (): TryComponentParserResult<'accepted'> => null,
    );

    expect(unwrap(parse(c))).toBeNull();
    expect(c.pos()).toBe(0);
    expectNextIdent(c, 'a');
  });

  it('continues sequence backtracking when projection rejects a successful attempt', () => {
    const parseAB = oneOf(
      [
        one(parseA),
        one(parseB),
      ],
      ([value]) => ok(value),
    );

    const projectedPrefixLengths: number[] = [];

    // (a | b)* b
    const parse = sequenceOf(
      [
        any(parseAB),
        one(parseB),
      ],
      ([prefix, suffix]) => {
        projectedPrefixLengths.push(prefix.length);

        if (prefix.length !== 1) {
          return null;
        }

        return ok({
          prefix,
          suffix,
        });
      },
    );

    const c = cursor('a b b');

    expect(unwrap(parse(c))).toEqual({
      prefix: ['a'],
      suffix: ['b'],
    });

    // The first full sequence match used prefix length 2 and was rejected.
    // The next successful backtracked match used prefix length 1 and was accepted.
    expect(projectedPrefixLengths).toEqual([2, 1]);

    // The accepted parse consumed `a b`; the final `b` remains for the caller.
    expectNextIdent(c, 'b');
  });

  it('tries the next alternative when a oneOf projection returns null', () => {
    const parseFirstA: TryComponentParser<'first'> = (c) => {
      const value = parseA(c);

      if (value === null) {
        return null;
      }

      return ok('first');
    };

    const parseSecondA: TryComponentParser<'second'> = (c) => {
      const value = parseA(c);

      if (value === null) {
        return null;
      }

      return ok('second');
    };

    const parse = oneOf(
      [
        one(parseFirstA),
        one(parseSecondA),
      ],
      ([value]) => {
        if (value === 'first') {
          return null;
        }

        return ok(value);
      },
    );

    const c = cursor('a');

    expect(unwrap(parse(c))).toBe('second');
    expectDone(c);
  });

  it('restores and fails allOf when its projection returns null', () => {
    const parse = allOf(
      [
        one(parseA),
        one(parseB),
      ],
      (): TryComponentParserResult<'accepted'> => null,
    );

    const c = cursor('b a');

    expect(unwrap(parse(c))).toBeNull();
    expect(c.pos()).toBe(0);
    expectNextIdent(c, 'b');
  });

  it('restores and fails someOf when its projection returns null', () => {
    const parse = someOf(
      [
        one(parseA),
        one(parseB),
      ],
      (): TryComponentParserResult<'accepted'> => null,
    );

    const c = cursor('a');

    expect(parse(c)).toBeNull();
    expect(c.pos()).toBe(0);
    expectNextIdent(c, 'a');
  });
});

describe('component grammar context plumbing', () => {
  it('passes context through parseAsComponentGrammar', () => {
    const context = { mode: 'test' };
    const seen: unknown[] = [];

    const parse: TryComponentParser<'a'> = (c) => {
      seen.push(c.context);
      return parseA(c);
    };

    expect(unwrap(parseAsComponentGrammar('a', parse, context))).toBe('a');
    expect(seen).toEqual([context]);
  });

  it('passes context through parseListAsComponentGrammar items', () => {
    const context = { mode: 'list-test' };
    const seen: unknown[] = [];

    const parse: TryComponentParser<'a'> = (c) => {
      seen.push(c.context);
      return parseA(c);
    };

    expect(parseListAsComponentGrammar('a, a', parse, context).map(unwrap)).toEqual([
      'a',
      'a',
    ]);

    expect(seen).toEqual([
      context,
      context,
    ]);
  });

  it('preserves cursor context through grammar combinators', () => {
    const context = { mode: 'combinator-test' };
    const seen: unknown[] = [];

    const parseContextAwareA: TryComponentParser<'a'> = (c) => {
      seen.push(c.context);
      return parseA(c);
    };

    const parse = sequenceOf(
      [
        one(parseContextAwareA),
        one(parseB),
      ],
      (value) => ok(value),
    );

    const c = cursor('a b', context);

    expect(unwrap(parse(c))).toEqual([
      ['a'],
      ['b'],
    ]);

    expectDone(c);
    expect(seen).toEqual([context]);
  });
});

describe('component grammar projection context', () => {
  it('passes cursor context to sequence projections', () => {
    const context = { foo: 'bar' };
    const seen: unknown[] = [];

    const parse = sequenceOf(
      [one(parseA)],
      ([value], ctx) => {
        seen.push(ctx);
        return ok(value[0]);
      },
    );

    const c = cursor('a', context);

    expect(unwrap(parse(c))).toBe('a');
    expect(seen).toEqual([context]);
    expectDone(c);
  });

  it('passes cursor context to alternative projections', () => {
    const context = { foo: 'bar' };
    const seen: unknown[] = [];

    const parse = oneOf(
      [
        one(parseA),
        one(parseB),
      ],
      (value, ctx) => {
        seen.push(ctx);
        return ok(value);
      },
    );

    const c = cursor('b', context);

    expect(unwrap(parse(c))).toEqual(['b']);
    expect(seen).toEqual([context]);
    expectDone(c);
  });

  it('passes cursor context to unordered projections', () => {
    const context = { foo: 'bar' };
    const seen: unknown[] = [];

    const parse = allOf(
      [
        one(parseA),
        one(parseB),
      ],
      (value, ctx) => {
        seen.push(ctx);
        return ok(value);
      },
    );

    const c = cursor('b a', context);

    expect(unwrap(parse(c))).toEqual([['a'], ['b']]);
    expect(seen).toEqual([context]);
    expectDone(c);
  });
});

describe('component parser bad results', () => {
  it('propagates bad from sequence components without restoring', () => {
    const c = cursor('a b');

    const parse = sequenceOf(
      [
        one(badAfterA('bad sequence')),
        one(parseB),
      ],
      (value) => ok(value),
    );

    const result = parse(c);

    expect(isBad(result)).toBe(true);
    expect(result).toMatchObject({
      message: 'bad sequence',
    });

    expectNextIdent(c, 'b');
  });

  it('does not try later alternatives after bad', () => {
    const c = cursor('a');

    let triedSecond = false;

    const parseSecond: TryComponentParser<'second'> = (inner) => {
      triedSecond = true;
      return parseA(inner) === null ? null : ok('second');
    };

    const parse = oneOf(
      [
        one(badAfterA('bad alternative')),
        one(parseSecond),
      ],
      ([value]) => ok(value),
    );

    const result = parse(c);

    expect(isBad(result)).toBe(true);
    expect(result).toMatchObject({
      message: 'bad alternative',
    });
    expect(triedSecond).toBe(false);
    expectDone(c);
  });

  it('propagates bad from repetitions without restoring', () => {
    const c = cursor('a b');

    const parse = plus(badAfterA('bad repetition'));
    const result = parse(c);

    expect(isBad(result)).toBe(true);
    expect(result).toMatchObject({
      message: 'bad repetition',
    });

    expectNextIdent(c, 'b');
  });

  it('preserves bad from parseAsComponentGrammar', () => {
    const result = parseAsComponentGrammar(
      'a',
      badAfterA('bad parseAsComponentGrammar'),
    );

    expect(isBad(result)).toBe(true);
    expect(result).toMatchObject({
      message: 'bad parseAsComponentGrammar',
    });
  });

  it('preserves bad items from parseListAsComponentGrammar', () => {
    const results = parseListAsComponentGrammar(
      'a, b',
      badAfterA('bad list item'),
    );

    expect(results).toHaveLength(2);

    expect(isBad(results[0])).toBe(true);
    expect(results[0]).toMatchObject({
      message: 'bad list item',
    });

    expect(results[1]).toBeNull();
  });

  it('preserves bad for each parseListAsComponentGrammar item', () => {
    const results = parseListAsComponentGrammar(
      'a, a',
      badAfterA('bad list item'),
    );

    expect(results).toHaveLength(2);
    expect(isBad(results[0])).toBe(true);
    expect(isBad(results[1])).toBe(true);
  });

});

type DemoContext = { mode?: string; };

const contextParser = <T extends string, R extends string>(
  expectedMode: string,
  literal: T,
  value: R,
): TryComponentParser<R> => {
  return (c) => {
    const context = c.context as DemoContext;

    if (context.mode !== expectedMode) {
      return null;
    }

    const matched = unwrapParseResultOrThrow(
      valueLiteralParser(literal)(c),
      `context literal ${literal}`,
    );

    if (matched === null) {
      return null;
    }

    return ok(value);
  };
};

const contextLeakingNullParser = (
  mode: string,
): TryComponentParser<'leaked'> => {
  return (c) => {
    c.context = { mode };
    return null;
  };
};

describe('component grammar contextAfter', () => {
  it('threads contextAfter from one sequence slot to later slots', () => {
    const baseContext: DemoContext = { mode: 'base' };

    const parse = sequenceOf(
      [
        one(parseA, {
          contextAfter: ([value], context) => ({
            ...(context as DemoContext),
            mode: value,
          }),
        }),
        one(contextParser('a', 'b', 'seen-a')),
      ],
      (value) => ok(value),
    );

    const c = cursor('a b', baseContext);

    expect(unwrap(parse(c))).toEqual([
      ['a'],
      ['seen-a'],
    ]);

    expectDone(c);
    expect(c.context).toBe(baseContext);
  });

  it('passes contextAfter context to sequence projection', () => {
    const baseContext: DemoContext = { mode: 'base' };
    const seen: unknown[] = [];

    const parse = sequenceOf(
      [
        one(parseA, {
          contextAfter: ([value], context) => ({
            ...(context as DemoContext),
            mode: value,
          }),
        }),
      ],
      ([value], context) => {
        seen.push(context);
        return ok(value);
      },
    );

    const c = cursor('a', baseContext);

    expect(unwrap(parse(c))).toEqual(['a']);
    expect(seen).toEqual([{ mode: 'a' }]);
    expect(c.context).toBe(baseContext);
  });

  it('threads contextAfter through nested sequence parsers', () => {
    const baseContext: DemoContext = { mode: 'base' };

    const inner = sequenceOf(
      [
        one(contextParser('a', 'b', 'inner')),
      ],
      ([value]) => ok(value),
    );

    const parse = sequenceOf(
      [
        one(parseA, {
          contextAfter: ([value], context) => ({
            ...(context as DemoContext),
            mode: value,
          }),
        }),
        one(inner),
      ],
      (value) => ok(value),
    );

    const c = cursor('a b', baseContext);

    expect(unwrap(parse(c))).toEqual([
      ['a'],
      [['inner']],
    ]);

    expectDone(c);
    expect(c.context).toBe(baseContext);
  });

  it('does not apply contextAfter inside oneOf alternatives to following alternatives', () => {
    const baseContext: DemoContext = { mode: 'base' };

    const parse = oneOf(
      [
        one(parseA, {
          contextAfter: () => ({ mode: 'first' }),
        }),
        one(contextParser('first', 'a', 'leaked')),
      ],
      (value) => {
        if (value[0] === 'a') {
          return null;
        }

        return ok(value);
      },
    );

    const c = cursor('a', baseContext);

    expect(unwrap(parse(c))).toBeNull();
    expect(c.pos()).toBe(0);
    expectNextIdent(c, 'a');
    expect(c.context).toBe(baseContext);
  });
});

describe('component grammar context restoration', () => {
  it('restores context when withComponentTrivia wrapper returns null', () => {
    const baseContext: DemoContext = { mode: 'base' };

    const parse = withComponentTrivia(
      contextLeakingNullParser('leaked'),
    );

    const c = cursor(' a', baseContext);

    expect(unwrap(parse(c))).toBeNull();
    expect(c.pos()).toBe(0);
    expect(c.context).toBe(baseContext);
  });

  it('restores context when a plain repetition item probe returns null', () => {
    const baseContext: DemoContext = { mode: 'base' };

    const parse = any(
      contextLeakingNullParser('leaked'),
    );

    const c = cursor('b', baseContext);

    expect(unwrap(parse(c))).toEqual([]);
    expect(c.pos()).toBe(0);
    expect(c.context).toBe(baseContext);
  });

  it('restores context when a comma repetition first item probe returns null', () => {
    const baseContext: DemoContext = { mode: 'base' };

    const parse = commaRepeat(
      contextLeakingNullParser('leaked'),
      0,
    );

    const c = cursor('b', baseContext);

    expect(unwrap(parse(c))).toEqual([]);
    expect(c.pos()).toBe(0);
    expect(c.context).toBe(baseContext);
  });

  it('recomputes contextAfter when sequence backtracks a direct multiplier slot', () => {
    const baseContext: DemoContext = { mode: 'base' };

    // a? a, where the second `a` only matches after the first slot backtracks
    // to empty and recomputes contextAfter with [].
    const parse = sequenceOf(
      [
        opt(parseA, {
          contextAfter: (value, context) => ({
            ...(context as DemoContext),
            mode: value.length === 0 ? 'empty-prefix' : 'used-prefix',
          }),
        }),
        one(contextParser('empty-prefix', 'a', 'suffix')),
      ],
      (value) => ok(value),
    );

    const c = cursor('a', baseContext);

    expect(unwrap(parse(c))).toEqual([
      [],
      ['suffix'],
    ]);

    expectDone(c);
    expect(c.context).toBe(baseContext);
  });
});
