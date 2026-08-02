import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../../src/stylelet/parser/component-cursor';
import {
  consumeComponentTrivia, isIdentToken, parseAsComponentGrammar, parseListAsComponentGrammar,
  parseListOfComponentValues,
} from '../../../../src/stylelet/parser/syntax';
import { TokenKind } from '../../../../src/stylelet/parser/tokens';
import {
  allOf, any, commaRepeat, one, oneOf, opt, plus,
  repeat, required, requiredAllOf, requiredSequenceOf, requiredSomeOf, sequenceOf, someOf,
  withTrivia,
} from '../../../../src/stylelet/parser/component-grammar';
import {
  bad, ComponentConsumerBadReason, isBad, ok, unwrapConsumeResultOrThrow,
  type TryComponentConsumer, type TryComponentConsumerResult,
} from '../../../../src/stylelet/parser/component-try-consumer';

const cursor = (css: string, context: unknown = undefined): ComponentCursor =>
  new ComponentCursor(parseListOfComponentValues(css), { context });

const literalConsumer = <T extends string>(expected: T): TryComponentConsumer<T> => {
  return (c: ComponentCursor): TryComponentConsumerResult<T> => {
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

const valueLiteralConsumer = <T extends string>(expected: T): TryComponentConsumer<T> =>
  withTrivia(literalConsumer(expected));

const consumeA = valueLiteralConsumer('a');
const consumeB = valueLiteralConsumer('b');
const consumeC = valueLiteralConsumer('c');

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

const unwrap = <T>(result: TryComponentConsumerResult<T>): T | null =>
  unwrapConsumeResultOrThrow(result, 'component grammar test result');

const badAfterA = (message = 'bad test consumer'): TryComponentConsumer<'bad'> => {
  return (c) => {
    const value = unwrapConsumeResultOrThrow(consumeA(c), 'bad test prefix');

    if (value === null) {
      return null;
    }

    return bad(ComponentConsumerBadReason.Invalid, message);
  };
};

describe('component value combinators', () => {
  it('parses unordered all-of components in grammar order', () => {
    const c = cursor('a b');

    // a && b
    const consumeAAndB = allOf(
      [
        one(consumeA),
        one(consumeB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(consumeAAndB(c))).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('parses unordered all-of components in swapped order', () => {
    const c = cursor('b a');

    // a && b
    const consumeAAndB = allOf(
      [
        one(consumeA),
        one(consumeB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(consumeAAndB(c))).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('allows optional components in unordered all-of groups', () => {
    const c = cursor('a');

    // a && b?
    const consumeAAndMaybeB = allOf(
      [
        one(consumeA),
        opt(consumeB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(consumeAAndMaybeB(c))).toEqual([['a'], []]);
    expectDone(c);
  });

  it('parses optional components before required components', () => {
    const c = cursor('b a');

    // a && b?
    const consumeAAndMaybeB = allOf(
      [
        one(consumeA),
        opt(consumeB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(consumeAAndMaybeB(c))).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('returns null when required unordered all-of components are missing', () => {
    const c = cursor('b');

    // a && b?
    const consumeAAndMaybeB = allOf(
      [
        one(consumeA),
        opt(consumeB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(consumeAAndMaybeB(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('parses unordered some-of components with one match', () => {
    const c = cursor('a');

    // a || b
    const consumeAOrBOrBoth = someOf(
      [
        one(consumeA),
        one(consumeB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(consumeAOrBOrBoth(c))).toEqual([['a'], undefined]);
    expectDone(c);
  });

  it('parses unordered some-of components with multiple matches in any order', () => {
    const c = cursor('b a');

    // a || b
    const consumeAOrBOrBoth = someOf(
      [
        one(consumeA),
        one(consumeB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(consumeAOrBOrBoth(c))).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('returns null when unordered some-of components do not match', () => {
    const c = cursor('d');

    // a || b
    const consumeAOrBOrBoth = someOf(
      [
        one(consumeA),
        one(consumeB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(consumeAOrBOrBoth(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('leaves duplicate components for the caller to reject', () => {
    const c = cursor('a a');

    // a || b
    const consumeAOrBOrBoth = someOf(
      [
        one(consumeA),
        one(consumeB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(consumeAOrBOrBoth(c))).toEqual([['a'], undefined]);
    expectNextIdent(c, 'a');
  });

  it('does not interleave inside grouped components', () => {
    const groupedBC: TryComponentConsumer<readonly ['b', 'c']> = (c: ComponentCursor) => {
      const start = c.pos();

      const bv = unwrapConsumeResultOrThrow(consumeB(c), 'grouped b');

      if (bv === null) {
        c.restore(start);
        return null;
      }

      consumeComponentTrivia(c);

      const cv = unwrapConsumeResultOrThrow(consumeC(c), 'grouped c');

      if (cv === null) {
        c.restore(start);
        return null;
      }

      return ok([bv, cv]);
    };

    // a || [ b c ]
    const consumeAOrGroupedBCOrBoth = someOf(
      [
        one(consumeA),
        one(groupedBC),
      ],
      (value) => ok(value),
    );

    const valid = cursor('a b c');

    expect(unwrap(consumeAOrGroupedBCOrBoth(valid))).toEqual([
      ['a'],
      [['b', 'c']],
    ]);

    expectDone(valid);

    const invalid = cursor('b a c');

    expect(unwrap(consumeAOrGroupedBCOrBoth(invalid))).toBeNull();
    expect(invalid.pos()).toBe(0);
  });

  it('parses juxtaposed components with sequence', () => {
    const c = cursor('a b');

    const consumeAB = sequenceOf(
      [
        one(consumeA),
        one(consumeB),
      ],
      (value) => ok(value),
    );

    const result = consumeAB(c);

    expect(unwrap(result)).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('parses alternatives with oneOf', () => {
    const c = cursor('b');

    const consumeAOrB = oneOf(
      [
        one(consumeA),
        one(consumeB),
      ],
      (value) => ok(value),
    );

    const result = consumeAOrB(c);

    expect(unwrap(result)).toEqual(['b']);
    expectDone(c);
  });

  it('returns null from oneOf when no alternatives match', () => {
    const c = cursor('c');

    const consumeAOrB = oneOf(
      [
        one(consumeA),
        one(consumeB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(consumeAOrB(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  // a b | c || d && e f
  it('composes grammar combinator precedence', () => {
    const consumeD = valueLiteralConsumer('d');
    const consumeE = valueLiteralConsumer('e');
    const consumeF = valueLiteralConsumer('f');

    // a b
    const consumeAB = sequenceOf(
      [
        one(consumeA),
        one(consumeB),
      ],
      (value) => ok(value),
    );

    // e f
    const consumeEF = sequenceOf(
      [
        one(consumeE),
        one(consumeF),
      ],
      (value) => ok(value),
    );

    // d && e f
    const consumeDAndEF = allOf(
      [
        one(consumeD),
        one(consumeEF),
      ],
      ([d, [ef]]) => ok([
        d,
        ef,
      ]),
    );

    // c || d && e f
    const consumeCOrDAndEF = someOf(
      [
        one(consumeC),
        one(consumeDAndEF),
      ],
      ([c, dAndEF]) => ok([
        c,
        dAndEF?.[0],
      ]),
    );

    // a b | c || d && e f
    const consumeWhole = oneOf(
      [
        one(consumeAB),
        one(consumeCOrDAndEF),
      ],
      ([value]) => ok(value),
    );

    const ab = cursor('a b');
    expect(unwrap(consumeWhole(ab))).toEqual([['a'], ['b']]);
    expectDone(ab);

    const reordered = cursor('e f d c');
    expect(unwrap(consumeWhole(reordered))).toEqual([
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
    expect(unwrap(consumeWhole(partial))).toEqual([
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
    const consumeAStar = repeat(consumeA, 0);
    const result = consumeAStar(c);

    expect(unwrap(result)).toEqual([]);
    expect(c.pos()).toBe(0);
  });

  it('parses one-or-more repetitions', () => {
    const c = cursor('a a b');

    // a+
    const consumeAPlus = repeat(consumeA, 1);
    const result = consumeAPlus(c);

    expect(unwrap(result)).toEqual(['a', 'a']);

    expectNextIdent(c, 'b');
  });

  it('parses bounded repetitions', () => {
    const c = cursor('a a a a');

    // a{1,3}
    const consumeOneToThreeA = repeat(consumeA, 1, 3);
    const result = consumeOneToThreeA(c);

    expect(unwrap(result)).toEqual(['a', 'a', 'a']);
    expectNextIdent(c, 'a');
  });

  it('returns null when repetition minimum is not met', () => {
    const c = cursor('a');

    // a{2,3}
    const consumeTwoToThreeA = repeat(consumeA, 2, 3);

    expect(unwrap(consumeTwoToThreeA(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('uses zero-to-one repetition as an optional component in sequence', () => {
    // a? b
    const consumeMaybeAThenB = sequenceOf(
      [
        repeat(consumeA, 0, 1),
        one(consumeB),
      ],
      (value) => ok(value),
    );

    const withA = cursor('a b');
    expect(unwrap(consumeMaybeAThenB(withA))).toEqual([['a'], ['b']]);
    expectDone(withA);

    const withoutA = cursor('b');
    expect(unwrap(consumeMaybeAThenB(withoutA))).toEqual([[], ['b']]);
    expectDone(withoutA);
  });

  it('parses comma-separated repetitions', () => {
    const c = cursor('a, a, a');

    // a#
    const consumeACommaList = commaRepeat(consumeA);
    const result = consumeACommaList(c);

    expect(unwrap(result)).toEqual(['a', 'a', 'a']);
    expectDone(c);
  });

  it('parses comma repetitions of optional sequences when each item consumes a value', () => {
    const c = cursor('a b c, a c, b');

    // [ a? b? c? ]#
    const tryConsumeOptionalABC = sequenceOf(
      [
        opt(consumeA),
        opt(consumeB),
        opt(consumeC),
      ],
      (value) => ok(value),
    );
    const tryConsumeOptionalABCList = commaRepeat(tryConsumeOptionalABC);

    expect(unwrap(tryConsumeOptionalABCList(c))).toEqual([
      [['a'], ['b'], ['c']],
      [['a'], [], ['c']],
      [[], ['b'], []],
    ]);
    expectDone(c);
  });

  it('throws when a comma-repeated optional sequence omits every item', () => {
    const c = cursor('');

    // [ a? b? c? ]#
    const tryConsumeOptionalABC = sequenceOf(
      [
        opt(consumeA),
        opt(consumeB),
        opt(consumeC),
      ],
      (value) => ok(value),
    );
    const tryConsumeOptionalABCList = commaRepeat(tryConsumeOptionalABC);

    expect(() => tryConsumeOptionalABCList(c)).toThrow('Comma repeat matched without consuming input');
    expect(c.pos()).toBe(0);
  });

  it('parses bounded comma-separated repetitions', () => {
    const c = cursor('a, a, a');

    // a#{1,2}
    const consumeOneToTwoA = commaRepeat(consumeA, 1, 2);
    const result = consumeOneToTwoA(c);

    expect(unwrap(result)).toEqual(['a', 'a']);
    expectNextComma(c);
  });

  it('leaves trailing comma for the caller to reject', () => {
    const c = cursor('a,');

    // a#
    const consumeACommaList = commaRepeat(consumeA);
    const result = consumeACommaList(c);

    expect(unwrap(result)).toEqual(['a']);
    expectNextComma(c);
  });

  it('returns null when comma-separated repetition minimum is not met', () => {
    const c = cursor('b');

    // a#
    const consumeACommaList = commaRepeat(consumeA);

    expect(unwrap(consumeACommaList(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('wraps try parsers as required parsers', () => {
    const consumeRequiredA = required(consumeA, 'Expected a');

    const valid = cursor('a');
    expect(consumeRequiredA(valid)).toBe('a');
    expectDone(valid);

    const invalid = cursor('b');
    expect(() => consumeRequiredA(invalid)).toThrow('Expected a');
    expect(invalid.pos()).toBe(0);
  });

  it('throws when a repeat parser succeeds without consuming input', () => {
    const consumeEmpty: TryComponentConsumer<'empty'> = () => ok('empty');

    const c = cursor('a');

    // empty+
    expect(() => plus(consumeEmpty)(c)).toThrow('Repeated consumer matched without consuming input');
  });

  it('parses exact repetitions', () => {
    const c = cursor('a a b');

    // a{2}
    const consumeExactlyTwoA = repeat(consumeA, 2, 2);
    const result = consumeExactlyTwoA(c);

    expect(unwrap(result)).toEqual(['a', 'a']);
    expectNextIdent(c, 'b');
  });

  it('parses zero exact repetitions', () => {
    const c = cursor('a');

    // a{0}
    const consumeExactlyZeroA = repeat(consumeA, 0, 0);
    const result = consumeExactlyZeroA(c);

    expect(unwrap(result)).toEqual([]);
    expect(c.pos()).toBe(0);
  });

  it('restores after partial repetition when minimum is not met', () => {
    const c = cursor('a b');

    // a{2,3}
    const consumeTwoToThreeA = repeat(consumeA, 2, 3);

    expect(unwrap(consumeTwoToThreeA(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('leaves repetitions beyond the default supported limit for the caller to reject', () => {
    const css = Array.from({ length: 21 }, () => 'a').join(' ');
    const c = cursor(css);

    // a+
    const consumeAPlus = repeat(consumeA, 1);
    const result = consumeAPlus(c);

    expect(unwrap(result)).toHaveLength(20);
    expectNextIdent(c, 'a');
  });

  it('parses zero-or-more comma repetitions', () => {
    const c = cursor('b');

    // a#?
    const consumeOptionalACommaList = commaRepeat(consumeA, 0);
    const result = consumeOptionalACommaList(c);

    expect(unwrap(result)).toEqual([]);
    expect(c.pos()).toBe(0);
  });

  it('restores comma-separated repetitions when minimum is not met', () => {
    const c = cursor('a');

    // a#{2,3}
    const consumeTwoToThreeA = commaRepeat(consumeA, 2, 3);

    expect(unwrap(consumeTwoToThreeA(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('does not parse a comma-separated repetition without a first item', () => {
    const c = cursor(', a');

    // a#
    const consumeACommaList = commaRepeat(consumeA);

    expect(unwrap(consumeACommaList(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('allows whitespace around comma separators', () => {
    const c = cursor('a ,  a');

    // a#
    const consumeACommaList = commaRepeat(consumeA);
    const result = consumeACommaList(c);

    expect(unwrap(result)).toEqual(['a', 'a']);
    expectDone(c);
  });

  it('leaves comma repetitions beyond the default supported limit for the caller to reject', () => {
    const css = Array.from({ length: 21 }, () => 'a').join(', ');
    const c = cursor(css);

    // a#
    const consumeACommaList = commaRepeat(consumeA);
    const result = consumeACommaList(c);

    expect(unwrap(result)).toHaveLength(20);
    expectNextComma(c);
  });

  it('throws when a comma-repeat parser succeeds without consuming input', () => {
    const consumeEmpty: TryComponentConsumer<'empty'> = () => ok('empty');

    const c = cursor('a');

    // empty#
    expect(() => commaRepeat(consumeEmpty)(c)).toThrow('Comma repeat matched without consuming input');
  });

  it('matches zero or more components in order: A? B? C?', () => {
    // A? B? C?
    const consumeZeroOrMoreInOrder = sequenceOf(
      [
        repeat(consumeA, 0, 1),
        repeat(consumeB, 0, 1),
        repeat(consumeC, 0, 1),
      ],
      (value) => ok(value),
    );

    const empty = cursor('');
    expect(unwrap(consumeZeroOrMoreInOrder(empty))).toEqual([[], [], []]);
    expectDone(empty);

    const sparse = cursor('a c');
    expect(unwrap(consumeZeroOrMoreInOrder(sparse))).toEqual([['a'], [], ['c']]);
    expectDone(sparse);
  });

  it('matches one or more components in order: [ A? B? C? ]!', () => {
    // [ A? B? C? ]!
    const consumeOneOrMoreInOrder = required(
      requiredSequenceOf(
        [
          repeat(consumeA, 0, 1),
          repeat(consumeB, 0, 1),
          repeat(consumeC, 0, 1),
        ],
        (value) => ok(value),
      ),
      'Expected one or more of a, b, c',
    );

    const empty = cursor('');
    expect(() => consumeOneOrMoreInOrder(empty)).toThrow('Expected one or more of a, b, c');

    const value = cursor('b c');
    expect(consumeOneOrMoreInOrder(value)).toEqual([[], ['b'], ['c']]);
    expectDone(value);
  });

  it('matches all components in order: A B C', () => {
    // A B C
    const consumeAllInOrder = sequenceOf(
      [
        one(consumeA),
        one(consumeB),
        one(consumeC),
      ],
      (value) => ok(value),
    );

    const valid = cursor('a b c');
    expect(unwrap(consumeAllInOrder(valid))).toEqual([['a'], ['b'], ['c']]);
    expectDone(valid);

    const invalid = cursor('a c');
    expect(unwrap(consumeAllInOrder(invalid))).toBeNull();
    expect(invalid.pos()).toBe(0);
  });

  it('matches zero or more components in any order: A? && B? && C?', () => {
    // A? && B? && C?
    const consumeOptionalABC = allOf(
      [
        opt(consumeA),
        opt(consumeB),
        opt(consumeC),
      ],
      (value) => ok(value),
    );

    const empty = cursor('');
    expect(unwrap(consumeOptionalABC(empty))).toEqual([
      [],
      [],
      [],
    ]);
    expectDone(empty);

    const reordered = cursor('c a');
    expect(unwrap(consumeOptionalABC(reordered))).toEqual([
      ['a'],
      [],
      ['c'],
    ]);
    expectDone(reordered);
  });

  it('matches one or more components in any order: A || B || C', () => {
    // A || B || C
    const consumeOneOrMoreABC = someOf(
      [
        one(consumeA),
        one(consumeB),
        one(consumeC),
      ],
      (value) => ok(value),
    );

    const c = cursor('b');
    expect(unwrap(consumeOneOrMoreABC(c))).toEqual([
      undefined,
      ['b'],
      undefined,
    ]);
    expectDone(c);

    const reordered = cursor('c a');
    expect(unwrap(consumeOneOrMoreABC(reordered))).toEqual([
      ['a'],
      undefined,
      ['c'],
    ]);
    expectDone(reordered);

    const empty = cursor('');
    expect(unwrap(consumeOneOrMoreABC(empty))).toBeNull();
    expect(empty.pos()).toBe(0);
  });

  it('matches all components in any order: A && B && C', () => {
    // A && B && C
    const consumeAllABC = allOf(
      [
        one(consumeA),
        one(consumeB),
        one(consumeC),
      ],
      (value) => ok(value),
    );

    const reordered = cursor('c a b');
    expect(unwrap(consumeAllABC(reordered))).toEqual([
      ['a'],
      ['b'],
      ['c'],
    ]);
    expectDone(reordered);

    const missing = cursor('c a');
    expect(unwrap(consumeAllABC(missing))).toBeNull();
    expect(missing.pos()).toBe(0);
  });

  it('matches zero or more components in any order: A? || B? || C?', () => {
    // A? || B? || C?
    const consumeOptionalABC = someOf(
      [
        opt(consumeA),
        opt(consumeB),
        opt(consumeC),
      ],
      (value) => ok(value),
    );

    const empty = cursor('');
    expect(unwrap(consumeOptionalABC(empty))).toEqual([
      [],
      [],
      [],
    ]);
    expectDone(empty);

    const reordered = cursor('c a');
    expect(unwrap(consumeOptionalABC(reordered))).toEqual([
      ['a'],
      [],
      ['c'],
    ]);
    expectDone(reordered);
  });

  it('allows comments between juxtaposed components', () => {
    const c = cursor('a/**/b');

    const consumeAB = sequenceOf(
      [
        one(consumeA),
        one(consumeB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(consumeAB(c))).toEqual([['a'], ['b']]);
    expectDone(c);
  });

  it('allows comments around comma separators', () => {
    const c = cursor('a/**/,/**/a');

    const consumeACommaList = commaRepeat(consumeA);

    expect(unwrap(consumeACommaList(c))).toEqual(['a', 'a']);
    expectDone(c);
  });

  it('keeps exclusive alternatives outside unordered groups', () => {
    const consumeNone = valueLiteralConsumer('none');
    const consumeUnderline = valueLiteralConsumer('underline');
    const consumeOverline = valueLiteralConsumer('overline');
    const consumeLineThrough = valueLiteralConsumer('line-through');
    const consumeBlink = valueLiteralConsumer('blink');

    // underline || overline || line-through || blink
    const consumeTextDecorationKeywords = someOf(
      [
        one(consumeUnderline),
        one(consumeOverline),
        one(consumeLineThrough),
        one(consumeBlink),
      ],
      (value) => ok(value),
    );

    // none | underline || overline || line-through || blink
    const consumeTextDecorationLine = oneOf(
      [
        one(consumeNone),
        one(consumeTextDecorationKeywords),
      ],
      ([value]) => ok(value),
    );

    // combinator precedence should not allow this to be consumed as
    // (none | underline) || overline || line-through || blink
    // const consumeTextDecorationLine_Wrong = someOf(
    //   one(
    //     oneOf(
    //       one(consumeNone),
    //       one(consumeUnderline),
    //       ([value]) => ok(value),
    //     ),
    //   ),
    //   one(consumeOverline),
    //   one(consumeLineThrough),
    //   one(consumeBlink),
    //   value => value,
    // );

    const none = cursor('none');
    expect(unwrap(consumeTextDecorationLine(none))).toEqual('none');
    expectDone(none);

    const reordered = cursor('overline underline');
    expect(unwrap(consumeTextDecorationLine(reordered))).toEqual([
      ['underline'],
      ['overline'],
      undefined,
      undefined,
    ]);
    expectDone(reordered);

    const invalid = cursor('none overline');
    expect(unwrap(consumeTextDecorationLine(invalid))).toEqual('none');
    expectNextIdent(invalid, 'overline');
  });

});

describe('component grammar trivia ownership', () => {
  const rawA = literalConsumer('a');
  const rawB = literalConsumer('b');

  it('keeps sequence tight when parsers are tight', () => {
    const c = cursor('a b');

    const consumeAB = sequenceOf(
      [
        one(rawA),
        one(rawB),
      ],
      (value) => ok(value),
    );

    expect(unwrap(consumeAB(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('allows value parsers to own leading trivia', () => {
    const c = cursor('a b');

    const consumeAB = sequenceOf(
      [
        one(withTrivia(rawA)),
        one(withTrivia(rawB)),
      ],
      (value) => ok(value),
    );

    expect(unwrap(consumeAB(c))).toEqual([['a'], ['b']]);
    expectDone(c);
  });
});

describe('selector separator trivia prototype', () => {
  type DemoCombinator = ' ' | '>' | '+' | '~' | '||';

  const consumeExplicitCombinator: TryComponentConsumer<DemoCombinator> = (c) => {
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

  const consumeSelectorSeparator: TryComponentConsumer<DemoCombinator> = (c) => {
    const start = c.pos();

    const sawWhitespace = c.match(TokenKind.Whitespace);
    const explicit = unwrapConsumeResultOrThrow(
      consumeExplicitCombinator(c),
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

    expect(unwrap(consumeSelectorSeparator(c))).toBe(' ');
    expectNextIdent(c, 'a');
  });

  it('treats whitespace before an explicit combinator as padding', () => {
    const c = cursor(' + a');

    expect(unwrap(consumeSelectorSeparator(c))).toBe('+');
    expectNextIdent(c, 'a');
  });

  it('parses explicit combinator without leading whitespace', () => {
    const c = cursor('+ a');

    expect(unwrap(consumeSelectorSeparator(c))).toBe('+');
    expectNextIdent(c, 'a');
  });

  it('parses column combinator', () => {
    const c = cursor(' || a');

    expect(unwrap(consumeSelectorSeparator(c))).toBe('||');
    expectNextIdent(c, 'a');
  });

  it('does not invent a separator without whitespace or explicit combinator', () => {
    const c = cursor('a');

    expect(unwrap(consumeSelectorSeparator(c))).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('requires at least one value in unordered all-of groups', () => {
    // [ a? && b? ]!
    const consumeOneOrMoreAB = requiredAllOf(
      [
        opt(consumeA),
        opt(consumeB),
      ],
      (value) => ok(value),
    );

    const empty = cursor('');
    expect(unwrap(consumeOneOrMoreAB(empty))).toBeNull();
    expect(empty.pos()).toBe(0);

    const valid = cursor('b');
    expect(unwrap(consumeOneOrMoreAB(valid))).toEqual([
      [],
      ['b'],
    ]);
    expectDone(valid);

    const reordered = cursor('b a');
    expect(unwrap(consumeOneOrMoreAB(reordered))).toEqual([
      ['a'],
      ['b'],
    ]);
    expectDone(reordered);
  });

  it('requires at least one multiplier value without throwing', () => {
    // [ a? b? ]!
    const consumeOneOrMoreAB = requiredSequenceOf(
      [
        repeat(consumeA, 0, 1),
        repeat(consumeB, 0, 1),
      ],
      (value) => ok(value),
    );

    const empty = cursor('');
    expect(unwrap(consumeOneOrMoreAB(empty))).toBeNull();
    expect(empty.pos()).toBe(0);

    const valid = cursor('b');
    expect(unwrap(consumeOneOrMoreAB(valid))).toEqual([[], ['b']]);
    expectDone(valid);
  });

  it('restores when requiredSequence sees only empty multiplier values', () => {
    // [ a? b? ]!
    const consumeOneOrMoreAB = requiredSequenceOf(
      [
        repeat(consumeA, 0, 1),
        repeat(consumeB, 0, 1),
      ],
      (value) => ok(value),
    );

    const c = cursor('c');

    expect(unwrap(consumeOneOrMoreAB(c))).toBeNull();
    expect(c.pos()).toBe(0);
    expectNextIdent(c, 'c');
  });

  it('treats non-empty nested unordered values as present in requiredSomeOf', () => {
    // [ a? || b? ]!
    const consumeAOrB = requiredSomeOf(
      [
        opt(consumeA),
        opt(consumeB),
      ],
      (value) => ok(value),
    );

    const empty = cursor('');
    expect(unwrap(consumeAOrB(empty))).toBeNull();
    expect(empty.pos()).toBe(0);

    const valid = cursor('a');
    expect(unwrap(consumeAOrB(valid))).toEqual([
      ['a'],
      [],
    ]);
    expectDone(valid);
  });

});

describe('component combinator null projections', () => {
  it('treats a null sequence projection as parser failure', () => {
    const c = cursor('a');

    const consume = sequenceOf(
      [one(consumeA)],
      (): TryComponentConsumerResult<'accepted'> => null,
    );

    expect(unwrap(consume(c))).toBeNull();
    expect(c.pos()).toBe(0);
    expectNextIdent(c, 'a');
  });

  it('tries the next alternative when a oneOf projection returns null', () => {
    const consumeFirstA: TryComponentConsumer<'first'> = (c) => {
      const value = consumeA(c);

      if (value === null) {
        return null;
      }

      return ok('first');
    };

    const consumeSecondA: TryComponentConsumer<'second'> = (c) => {
      const value = consumeA(c);

      if (value === null) {
        return null;
      }

      return ok('second');
    };

    const consume = oneOf(
      [
        one(consumeFirstA),
        one(consumeSecondA),
      ],
      ([value]) => {
        if (value === 'first') {
          return null;
        }

        return ok(value);
      },
    );

    const c = cursor('a');

    expect(unwrap(consume(c))).toBe('second');
    expectDone(c);
  });

  it('restores and fails allOf when its projection returns null', () => {
    const consume = allOf(
      [
        one(consumeA),
        one(consumeB),
      ],
      (): TryComponentConsumerResult<'accepted'> => null,
    );

    const c = cursor('b a');

    expect(unwrap(consume(c))).toBeNull();
    expect(c.pos()).toBe(0);
    expectNextIdent(c, 'b');
  });

  it('restores and fails someOf when its projection returns null', () => {
    const consume = someOf(
      [
        one(consumeA),
        one(consumeB),
      ],
      (): TryComponentConsumerResult<'accepted'> => null,
    );

    const c = cursor('a');

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
    expectNextIdent(c, 'a');
  });
});

describe('component grammar context plumbing', () => {
  it('passes context through parseAsComponentGrammar', () => {
    const context = { mode: 'test' };
    const seen: unknown[] = [];

    const consume: TryComponentConsumer<'a'> = (c) => {
      seen.push(c.context);
      return consumeA(c);
    };

    expect(unwrap(parseAsComponentGrammar('a', consume, context))).toBe('a');
    expect(seen).toEqual([context]);
  });

  it('passes context through parseListAsComponentGrammar items', () => {
    const context = { mode: 'list-test' };
    const seen: unknown[] = [];

    const consume: TryComponentConsumer<'a'> = (c) => {
      seen.push(c.context);
      return consumeA(c);
    };

    expect(parseListAsComponentGrammar('a, a', consume, context).map(unwrap)).toEqual([
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

    const consumeContextAwareA: TryComponentConsumer<'a'> = (c) => {
      seen.push(c.context);
      return consumeA(c);
    };

    const consume = sequenceOf(
      [
        one(consumeContextAwareA),
        one(consumeB),
      ],
      (value) => ok(value),
    );

    const c = cursor('a b', context);

    expect(unwrap(consume(c))).toEqual([
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

    const consume = sequenceOf(
      [one(consumeA)],
      ([value], ctx) => {
        seen.push(ctx);
        return ok(value[0]);
      },
    );

    const c = cursor('a', context);

    expect(unwrap(consume(c))).toBe('a');
    expect(seen).toEqual([context]);
    expectDone(c);
  });

  it('passes cursor context to alternative projections', () => {
    const context = { foo: 'bar' };
    const seen: unknown[] = [];

    const consume = oneOf(
      [
        one(consumeA),
        one(consumeB),
      ],
      (value, ctx) => {
        seen.push(ctx);
        return ok(value);
      },
    );

    const c = cursor('b', context);

    expect(unwrap(consume(c))).toEqual(['b']);
    expect(seen).toEqual([context]);
    expectDone(c);
  });

  it('passes cursor context to unordered projections', () => {
    const context = { foo: 'bar' };
    const seen: unknown[] = [];

    const consume = allOf(
      [
        one(consumeA),
        one(consumeB),
      ],
      (value, ctx) => {
        seen.push(ctx);
        return ok(value);
      },
    );

    const c = cursor('b a', context);

    expect(unwrap(consume(c))).toEqual([['a'], ['b']]);
    expect(seen).toEqual([context]);
    expectDone(c);
  });
});

describe('component parser bad results', () => {
  it('propagates bad from sequence components without restoring', () => {
    const c = cursor('a b');

    const consume = sequenceOf(
      [
        one(badAfterA('bad sequence')),
        one(consumeB),
      ],
      (value) => ok(value),
    );

    const result = consume(c);

    expect(isBad(result)).toBe(true);
    expect(result).toMatchObject({
      message: 'bad sequence',
    });

    expectNextIdent(c, 'b');
  });

  it('does not try later alternatives after bad', () => {
    const c = cursor('a');

    let triedSecond = false;

    const consumeSecond: TryComponentConsumer<'second'> = (inner) => {
      triedSecond = true;
      return consumeA(inner) === null ? null : ok('second');
    };

    const consume = oneOf(
      [
        one(badAfterA('bad alternative')),
        one(consumeSecond),
      ],
      ([value]) => ok(value),
    );

    const result = consume(c);

    expect(isBad(result)).toBe(true);
    expect(result).toMatchObject({
      message: 'bad alternative',
    });
    expect(triedSecond).toBe(false);
    expectDone(c);
  });

  it('propagates bad from repetitions without restoring', () => {
    const c = cursor('a b');

    const consume = plus(badAfterA('bad repetition'));
    const result = consume(c);

    expect(isBad(result)).toBe(true);
    expect(result).toMatchObject({
      message: 'bad repetition',
    });

    expectNextIdent(c, 'b');
  });

  it('propagates bad from a nullable probe without restoring', () => {
    const context = { mode: 'test' };
    let calls = 0;

    const consumeProbe: TryComponentConsumer<'a'> = (c) => {
      calls++;

      if (calls === 1) {
        return null;
      }

      const value = unwrapConsumeResultOrThrow(
        consumeA(c),
        'nullable bad probe',
      );

      if (value === null) {
        return null;
      }

      return bad(
        ComponentConsumerBadReason.Invalid,
        'bad nullable probe',
      );
    };

    const consume = allOf(
      [opt(consumeProbe)],
      (value) => ok(value),
    );

    const c = cursor('a', context);
    const result = consume(c);

    expect(isBad(result)).toBe(true);
    expect(result).toMatchObject({
      message: 'bad nullable probe',
    });
    expectDone(c);
    expect(c.context).toBe(context);
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

const contextConsumer = <T extends string, R extends string>(
  expectedMode: string,
  literal: T,
  value: R,
): TryComponentConsumer<R> => {
  return (c) => {
    const context = c.context as DemoContext;

    if (context.mode !== expectedMode) {
      return null;
    }

    const matched = unwrapConsumeResultOrThrow(
      valueLiteralConsumer(literal)(c),
      `context literal ${literal}`,
    );

    if (matched === null) {
      return null;
    }

    return ok(value);
  };
};

const contextLeakingNullConsumer = (
  mode: string,
): TryComponentConsumer<'leaked'> => {
  return (c) => {
    c.context = { mode };
    return null;
  };
};

describe('component grammar contextAfter', () => {
  it('passes advanced context to later sequence slots', () => {
    const baseContext: DemoContext = { mode: 'base' };

    const consume = sequenceOf(
      [
        one(consumeA, {
          contextAfter: (value, context) => ({
            ...(context as DemoContext),
            mode: value,
          }),
        }),
        one(contextConsumer('a', 'b', 'seen-a')),
      ],
      (value) => ok(value),
    );

    const c = cursor('a b', baseContext);

    expect(unwrap(consume(c))).toEqual([
      ['a'],
      ['seen-a'],
    ]);

    expectDone(c);
    expect(c.context).toBe(baseContext);
  });

  it('passes advanced context to the sequence projection', () => {
    const baseContext: DemoContext = { mode: 'base' };
    const seen: unknown[] = [];

    const consume = sequenceOf(
      [
        one(consumeA, {
          contextAfter: (value, context) => ({
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

    expect(unwrap(consume(c))).toEqual(['a']);
    expect(seen).toEqual([{ mode: 'a' }]);
    expect(c.context).toBe(baseContext);
  });

  it('passes advanced context into a nested sequence parser', () => {
    const baseContext: DemoContext = { mode: 'base' };

    const inner = sequenceOf(
      [
        one(contextConsumer('a', 'b', 'inner')),
      ],
      ([value]) => ok(value),
    );

    const consume = sequenceOf(
      [
        one(consumeA, {
          contextAfter: (value, context) => ({
            ...(context as DemoContext),
            mode: value,
          }),
        }),
        one(inner),
      ],
      (value) => ok(value),
    );

    const c = cursor('a b', baseContext);

    expect(unwrap(consume(c))).toEqual([
      ['a'],
      [['inner']],
    ]);

    expectDone(c);
    expect(c.context).toBe(baseContext);
  });

  it('does not leak contextAfter from a rejected oneOf alternative', () => {
    const baseContext: DemoContext = { mode: 'base' };

    const consume = oneOf(
      [
        one(consumeA, {
          contextAfter: () => ({ mode: 'first' }),
        }),
        one(contextConsumer('first', 'a', 'leaked')),
      ],
      (value) => {
        if (value[0] === 'a') {
          return null;
        }

        return ok(value);
      },
    );

    const c = cursor('a', baseContext);

    expect(unwrap(consume(c))).toBeNull();
    expect(c.pos()).toBe(0);
    expectNextIdent(c, 'a');
    expect(c.context).toBe(baseContext);
  });

  it('applies contextAfter to each plain multiplier item', () => {
    type ItemContext = {
      values: unknown[];
    };

    const baseContext: ItemContext = {
      values: [],
    };

    const consume = sequenceOf(
      [
        any(consumeA, {
          contextAfter: (value, context) => {
            const current = context as ItemContext;

            return {
              ...current,
              values: [...current.values, value],
            };
          },
        }),
      ],
      ([values], context) => ok({
        values,
        contextValues: (context as ItemContext).values,
      }),
    );

    const c = cursor('a a', baseContext);

    expect(unwrap(consume(c))).toEqual({
      values: ['a', 'a'],
      contextValues: ['a', 'a'],
    });

    expectDone(c);
    expect(c.context).toBe(baseContext);
  });

  it('threads context between plain multiplier items without leaking item-local context', () => {
    const baseContext: DemoContext = {
      mode: 'base',
    };

    const consumeContextMutatingA: TryComponentConsumer<string> = (c) => {
      const mode = (c.context as DemoContext).mode ?? 'missing';

      const value = unwrapConsumeResultOrThrow(
        consumeA(c),
        'context repetition item',
      );

      if (value === null) {
        return null;
      }

      c.context = {
        mode: 'item-local',
      };

      return ok(mode);
    };

    const consume = sequenceOf(
      [
        any(consumeContextMutatingA, {
          contextAfter: (_value, context) => {
            const current = context as DemoContext;

            return {
              ...current,
              mode:
                current.mode === 'base'
                  ? 'after-first'
                  : 'after-second',
            };
          },
        }),

        one(contextConsumer('after-second', 'b', 'suffix')),
      ],
      (value) => ok(value),
    );

    const c = cursor('a a b', baseContext);

    expect(unwrap(consume(c))).toEqual([
      ['base', 'after-first'],
      ['suffix'],
    ]);

    expectDone(c);
    expect(c.context).toBe(baseContext);
  });

  it('applies contextAfter to each comma multiplier item', () => {
    type ItemContext = {
      values: unknown[];
    };

    const baseContext: ItemContext = {
      values: [],
    };

    const consume = sequenceOf(
      [
        commaRepeat(consumeA, {
          contextAfter: (value, context) => {
            const current = context as ItemContext;

            return {
              ...current,
              values: [...current.values, value],
            };
          },
        }),
      ],
      ([values], context) => ok({
        values,
        contextValues: (context as ItemContext).values,
      }),
    );

    const c = cursor('a, a', baseContext);

    expect(unwrap(consume(c))).toEqual({
      values: ['a', 'a'],
      contextValues: ['a', 'a'],
    });

    expectDone(c);
    expect(c.context).toBe(baseContext);
  });

});

describe('component grammar context restoration', () => {
  it('restores context when withComponentTrivia wrapper returns null', () => {
    const baseContext: DemoContext = { mode: 'base' };

    const consume = withTrivia(
      contextLeakingNullConsumer('leaked'),
    );

    const c = cursor(' a', baseContext);

    expect(unwrap(consume(c))).toBeNull();
    expect(c.pos()).toBe(0);
    expect(c.context).toBe(baseContext);
  });

  it('restores context when a plain repetition item probe returns null', () => {
    const baseContext: DemoContext = { mode: 'base' };

    const consume = any(
      contextLeakingNullConsumer('leaked'),
    );

    const c = cursor('b', baseContext);

    expect(unwrap(consume(c))).toEqual([]);
    expect(c.pos()).toBe(0);
    expect(c.context).toBe(baseContext);
  });

  it('restores context when a comma repetition first item probe returns null', () => {
    const baseContext: DemoContext = { mode: 'base' };

    const consume = commaRepeat(
      contextLeakingNullConsumer('leaked'),
      0,
    );

    const c = cursor('b', baseContext);

    expect(unwrap(consume(c))).toEqual([]);
    expect(c.pos()).toBe(0);
    expect(c.context).toBe(baseContext);
  });

  it('restores accumulated context when repetition minimum is not met', () => {
    const baseContext: DemoContext = {
      mode: 'base',
    };

    const consume = repeat(consumeA, 2, 2, {
      contextAfter: (_value, context) => ({
        ...(context as DemoContext),
        mode: 'advanced',
      }),
    });

    const c = cursor('a b', baseContext);

    expect(unwrap(consume(c))).toBeNull();
    expect(c.pos()).toBe(0);
    expect(c.context).toBe(baseContext);
  });

  it('restores accumulated context when a later repetition item is bad', () => {
    const baseContext: DemoContext = {
      mode: 'base',
    };

    const consumeAOrBadB: TryComponentConsumer<'a'> = (c) => {
      const a = consumeA(c);

      if (a !== null) {
        return a;
      }

      const b = unwrapConsumeResultOrThrow(
        consumeB(c),
        'bad repetition item',
      );

      if (b === null) {
        return null;
      }

      return bad(
        ComponentConsumerBadReason.Invalid,
        'bad repetition item',
      );
    };

    const consume = plus(consumeAOrBadB, {
      contextAfter: (_value, context) => ({
        ...(context as DemoContext),
        mode: 'advanced',
      }),
    });

    const c = cursor('a b', baseContext);
    const result = consume(c);

    expect(isBad(result)).toBe(true);
    expect(result).toMatchObject({
      message: 'bad repetition item',
    });

    expectDone(c);
    expect(c.context).toBe(baseContext);
  });
});
