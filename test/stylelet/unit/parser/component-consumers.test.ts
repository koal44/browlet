import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../../src/stylelet/parser/component-cursor';
import {
  createDelimConsumer, createFreeFormConsumer, createFunctionalNotationConsumer,
  tryConsumeAnyValueFunctionBlock,
} from '../../../../src/stylelet/parser/component-consumers';

import { BlockKind, isTokenKind, parseAsComponentGrammar, parseListOfComponentValues } from '../../../../src/stylelet/parser/syntax';
import { tryConsumeAnyValue } from '../../../../src/stylelet/values/any-value';
import { BadStringToken, TokenKind } from '../../../../src/stylelet/parser/tokens';
import { ColorKind, resolveColorValue, serializeColorValue, tryConsumeColor } from '../../../../src/stylelet/values/color';
import { createWholeValueConsumer } from '../../../../src/stylelet/values/whole-value';

describe('createFreeFormConsumer', () => {
  const consumeColorWholeValue = createWholeValueConsumer(
    tryConsumeColor,
    resolveColorValue,
    serializeColorValue,
  );
  const consumeFreeFormColorWholeValue =
    createFreeFormConsumer(consumeColorWholeValue);

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
    const result = parseAsComponentGrammar(input, consumeFreeFormColorWholeValue);
    const value = result;

    expect(value).toMatchObject({
      type: 'whole-value',
      value: {
        kind: ColorKind.Named,
        name: 'red',
      },
    });
    expect(value!.serialize()).toBe('red');
  });

  it('stops an unwrapped value before a top-level comma', () => {
    const c = new ComponentCursor(parseListOfComponentValues('red, blue'));

    expect(consumeFreeFormColorWholeValue(c)).toMatchObject({
      type: 'whole-value',
      value: {
        kind: ColorKind.Named,
        name: 'red',
      },
    });
    expect(isTokenKind(c.peek(), TokenKind.Comma)).toBe(true);
  });

  it('requires the unwrapped partition to match the complete value grammar', () => {
    const c = new ComponentCursor(parseListOfComponentValues('red blue'));

    expect(consumeFreeFormColorWholeValue(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('supports an additional top-level boundary predicate', () => {
    const consume = createFreeFormConsumer(consumeColorWholeValue, {
      stopBefore: (component) => isTokenKind(component, TokenKind.Colon),
    });
    const c = new ComponentCursor(parseListOfComponentValues('red: blue'));

    expect(consume(c)).toMatchObject({
      type: 'whole-value',
      value: {
        kind: ColorKind.Named,
        name: 'red',
      },
    });
    expect(isTokenKind(c.peek(), TokenKind.Colon)).toBe(true);
  });

  it('prevents a strict any-value from crossing a top-level comma', () => {
    const c = new ComponentCursor(parseListOfComponentValues('red, blue'));
    const consume = createFreeFormConsumer(tryConsumeAnyValue);

    expect(consume(c)).toMatchObject({
      type: 'any-value',
    });
    expect(isTokenKind(c.peek(), TokenKind.Comma)).toBe(true);
  });

  it('allows top-level commas in a non-strict any-value', () => {
    const consume = createFreeFormConsumer(tryConsumeAnyValue, { strict: false });
    const c = new ComponentCursor(parseListOfComponentValues('red, blue'));

    expect(consume(c)).toMatchObject({
      type: 'any-value',
    });
    expect(c.peek()).toBeNull();
  });

  it('includes a top-level comma in a non-strict partition', () => {
    const consume = createFreeFormConsumer(consumeColorWholeValue, { strict: false });
    const c = new ComponentCursor(parseListOfComponentValues('red, blue'));

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('includes a brace block in a non-strict partition', () => {
    const consume = createFreeFormConsumer(consumeColorWholeValue, { strict: false });
    const c = new ComponentCursor(parseListOfComponentValues('red {blue}'));

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });
});

describe('tryConsumeAnyValueFunctionBlock', () => {
  it('consumes one functional notation and leaves following components', () => {
    const c = new ComponentCursor(parseListOfComponentValues('fn(value) other'));

    expect(tryConsumeAnyValueFunctionBlock(c)).toMatchObject({
      type: 'block',
      block: BlockKind.Function,
      name: 'fn',
      value: {
        type: 'any-value',
      },
    });
    expect(c.pos()).toBe(1);
  });

  it('accepts a function that CSS Syntax automatically closes at EOF', () => {
    const c = new ComponentCursor(parseListOfComponentValues('fn(value'));

    expect(tryConsumeAnyValueFunctionBlock(c)).toMatchObject({
      type: 'block',
      block: BlockKind.Function,
      name: 'fn',
    });
    expect(c.pos()).toBe(1);
  });

  it.each(['fn()', 'fn(])'])('returns null without advancing for %j', (input) => {
    const c = new ComponentCursor(parseListOfComponentValues(input));

    expect(tryConsumeAnyValueFunctionBlock(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });
});

describe('createFunctionalNotationConsumer', () => {
  it('returns null when the matched function has invalid components', () => {
    const c = new ComponentCursor([{
      type: 'block',
      block: BlockKind.Function,
      name: 'fn',
      value: [BadStringToken],
    }]);
    const consume = createFunctionalNotationConsumer(
      'fn',
      (arguments_) => arguments_.next(),
      (value) => value,
    );

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('returns null when the arguments do not match their grammar', () => {
    const c = new ComponentCursor(parseListOfComponentValues('fn(other)'));
    const consume = createFunctionalNotationConsumer(
      'fn',
      createDelimConsumer('/'),
      (value) => value,
    );

    expect(consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });
});
