import {
  describe, expect,
  it,
} from 'vitest';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import {
  consumeWhitespace, createFreeFormConsumer, createKeywordConsumer,
  createFunctionalNotationConsumer, consumeAnyValueFunctionBlock, consumeBraceBlock,
  consumeBracketBlock, consumeFunctionBlock, consumeParensBlock, consumeSlashDelim,
} from '../../../../src/stylelet/syntax/component-consumers';
import { isTokenKind } from '../../../../src/stylelet/syntax/component-value';
import { parseAsComponentGrammar, parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { AnyValue } from '../../../../src/stylelet/values/any-value';
import { OptionalDeclarationValue } from '../../../../src/stylelet/values/declaration-value';
import { EOFToken, TokenKind } from '../../../../src/stylelet/syntax/tokens';
import { ColorKind, ColorValue } from '../../../../src/stylelet/values/color';

describe('createKeywordConsumer', () => {
  it('creates case-insensitive singleton and grouped keyword consumers', () => {
    const consumeAuto = createKeywordConsumer('auto');
    const consumeStrategy = createKeywordConsumer('nearest', 'up', 'to-zero');

    expect(consumeAuto(new TokenCursor(parseListOfComponentValues('AUTO', {}), {})))
      .toBe('auto');
    expect(consumeStrategy(new TokenCursor(parseListOfComponentValues('To-ZeRo', {}), {})))
      .toBe('to-zero');
  });

  it('leaves component trivia to the caller', () => {
    const cursor = new TokenCursor(parseListOfComponentValues(' auto', {}), {});

    expect(createKeywordConsumer('auto')(cursor)).toBeNull();
    expect(cursor.pos()).toBe(0);
  });
});

describe('consumeWhitespace', () => {
  it('consumes consecutive whitespace components', () => {
    const c = new TokenCursor(parseListOfComponentValues('  value', {}), {});

    consumeWhitespace(c);

    expect(isTokenKind(c.peek(), TokenKind.Ident)).toBe(true);
    expect(c.pos()).toBe(1);
  });
});

describe('createFreeFormConsumer', () => {
  const consumeFreeFormColor = createFreeFormConsumer(ColorValue.consume);

  it.each([
    'red',
    ' red',
    'red ',
    ' red ',
    '{red}',
    ' {red}',
    '{red} ',
    ' {red} ',
    '{ red }',
    ' { red } ',
  ])('parses %j as the same value', (input) => {
    const value = parseAsComponentGrammar(input, consumeFreeFormColor, {});

    expect(value?.repr).toMatchObject({
      kind: ColorKind.Named,
      name: 'red',
    });
  });

  it('stops an unwrapped value before a top-level comma', () => {
    const c = new TokenCursor(parseListOfComponentValues('red, blue', {}), {});

    expect(consumeFreeFormColor(c)?.repr).toMatchObject({
      kind: ColorKind.Named,
      name: 'red',
    });
    expect(isTokenKind(c.peek(), TokenKind.Comma)).toBe(true);
  });

  it('requires the unwrapped partition to match the complete value grammar', () => {
    const c = new TokenCursor(parseListOfComponentValues('red blue', {}), {});

    expect(consumeFreeFormColor(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('supports an additional top-level boundary predicate', () => {
    const consume = createFreeFormConsumer(ColorValue.consume, {
      stopBefore: (component) => isTokenKind(component, TokenKind.Colon),
    });
    const c = new TokenCursor(parseListOfComponentValues('red: blue', {}), {});

    expect(consume(c)?.repr).toMatchObject({
      kind: ColorKind.Named,
      name: 'red',
    });
    expect(isTokenKind(c.peek(), TokenKind.Colon)).toBe(true);
  });

  it('prevents a strict any-value from crossing a top-level comma', () => {
    const c = new TokenCursor(parseListOfComponentValues('red, blue', {}), {});
    const consume = createFreeFormConsumer(AnyValue.consume);

    expect(consume(c)).toBeInstanceOf(AnyValue);
    expect(isTokenKind(c.peek(), TokenKind.Comma)).toBe(true);
  });

  it('allows top-level commas in a non-strict any-value', () => {
    const consume = createFreeFormConsumer(AnyValue.consume, { strict: false });
    const c = new TokenCursor(parseListOfComponentValues('red, blue', {}), {});

    expect(consume(c)).toBeInstanceOf(AnyValue);
    expect(c.peek()).toBe(EOFToken);
  });

  it('includes a top-level comma in a non-strict partition', () => {
    const consume = createFreeFormConsumer(ColorValue.consume, { strict: false });
    const c = new TokenCursor(parseListOfComponentValues('red, blue', {}), {});

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('includes a brace block in a non-strict partition', () => {
    const consume = createFreeFormConsumer(ColorValue.consume, { strict: false });
    const c = new TokenCursor(parseListOfComponentValues('red {blue}', {}), {});

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('delegates an empty partition to an optional declaration-value grammar', () => {
    const consume = createFreeFormConsumer(OptionalDeclarationValue.consume);
    const c = new TokenCursor(parseListOfComponentValues('', {}), {});

    expect(consume(c)).toEqual({
      repr: parseListOfComponentValues('', {}),
    });
  });
});

describe('consumeAnyValueFunctionBlock', () => {
  it('retains the original function block and source while consuming only it', () => {
    const list = parseListOfComponentValues('fn(value) other', {});
    const c = new TokenCursor(list, {});

    const block = consumeAnyValueFunctionBlock(c);
    expect(block).toMatchObject({
      type: TokenKind.FunctionBlock,
      name: 'fn',
    });
    expect(block).toBe(list.tokens[0]);
    expect(block?.value.sourceText()).toBe('value');
    expect(c.pos()).toBe(1);
  });

  it('accepts a function that CSS Syntax automatically closes at EOF', () => {
    const c = new TokenCursor(parseListOfComponentValues('fn(value', {}), {});

    expect(consumeAnyValueFunctionBlock(c)).toMatchObject({
      type: TokenKind.FunctionBlock,
      name: 'fn',
    });
    expect(c.pos()).toBe(1);
  });

  it('accepts empty nested blocks within nonempty contents', () => {
    const list = parseListOfComponentValues('fn(nested())', {});
    const c = new TokenCursor(list, {});

    expect(consumeAnyValueFunctionBlock(c)).toBe(list.tokens[0]);
    expect(c.pos()).toBe(1);
  });

  it.each(['fn()', 'fn(])', 'fn(nested(]))'])('returns null without advancing for %j', (input) => {
    const c = new TokenCursor(parseListOfComponentValues(input, {}), {});

    expect(consumeAnyValueFunctionBlock(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });
});

describe('block consumers', () => {
  it.each([
    ['{value} other', consumeBraceBlock, TokenKind.BraceBlock],
    ['[value] other', consumeBracketBlock, TokenKind.BracketBlock],
    ['(value) other', consumeParensBlock, TokenKind.ParensBlock],
    ['fn(value) other', consumeFunctionBlock, TokenKind.FunctionBlock],
  ] as const)('consumes one block from %j and leaves following components', (input, consume, block) => {
    const c = new TokenCursor(parseListOfComponentValues(input, {}), {});

    expect(consume(c)).toMatchObject({ type: block });
    expect(c.pos()).toBe(1);
  });

  it.each([
    consumeBraceBlock,
    consumeBracketBlock,
    consumeParensBlock,
    consumeFunctionBlock,
  ])('returns null without advancing when the block kind differs', (consume) => {
    const c = new TokenCursor(parseListOfComponentValues('ident', {}), {});

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });
});

describe('createFunctionalNotationConsumer', () => {
  it('returns null when the matched function has invalid components', () => {
    const c = new TokenCursor(parseListOfComponentValues('fn("bad\n)', {}), {});
    const consume = createFunctionalNotationConsumer(
      'fn',
      (args) => args.next(),
      (value) => value,
    );

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('returns null when the arguments do not match their grammar', () => {
    const c = new TokenCursor(parseListOfComponentValues('fn(other)', {}), {});
    const consume = createFunctionalNotationConsumer(
      'fn',
      consumeSlashDelim,
      (value) => value,
    );

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });
});
