import { describe, expect, it } from 'vitest';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import {
  isTokenKind, serializeComponentValues,
} from '../../../../src/stylelet/syntax/component-value';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { TokenKind } from '../../../../src/stylelet/syntax/tokens';
import {
  parseFirstValid, serializeFirstValid, consumeFirstValid,
} from '../../../../src/stylelet/values/substitution/first-valid';

describe('<first-valid()>', () => {
  it('parses a nonempty comma-separated list of declaration values', () => {
    const value = parseFirstValid('first-valid(red, 1px, rgb(0, 0, 0))');

    expect(value?.type).toBe('first-valid');
    expect(value?.arguments.map((argument) =>
      serializeComponentValues(argument.components)
    )).toEqual(['red', '1px', 'rgb(0, 0, 0)']);
  });

  it('matches the function name case-insensitively with outer trivia', () => {
    expect(parseFirstValid('  FIRST-VALID(red)  ')?.type).toBe('first-valid');
  });

  it('uses braces to bound an argument containing top-level commas', () => {
    const value = parseFirstValid(
      'first-valid({Times, serif}, sans-serif)',
    );

    expect(value?.arguments.map((argument) =>
      serializeComponentValues(argument.components)
    )).toEqual(['Times, serif', 'sans-serif']);
  });

  it('allows braces around an argument that does not require them', () => {
    const value = parseFirstValid('first-valid({red}, blue)');

    expect(value?.arguments.map((argument) =>
      serializeComponentValues(argument.components)
    )).toEqual(['red', 'blue']);
    expect(serializeFirstValid(value!)).toBe('first-valid(red, blue)');
  });

  it('preserves braces required to bound a free-form argument', () => {
    const value = parseFirstValid('first-valid({Times, serif}, sans-serif)');

    expect(serializeFirstValid(value!))
      .toBe('first-valid({Times, serif}, sans-serif)');
  });

  it.each([
    'first-valid()',
    'first-valid(, red)',
    'first-valid(red,)',
    'first-valid(red ! blue, green)',
    'first-valid(red; blue, green)',
    'first-valid(red {blue}, green)',
  ])('rejects %j', (input) => {
    expect(parseFirstValid(input)).toBeNull();
  });

  it('consumes one notation without consuming following input', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('first-valid(red, blue) trailing'),
    );

    expect(consumeFirstValid(c)?.type).toBe('first-valid');
    expect(isTokenKind(c.peek(), TokenKind.Whitespace)).toBe(true);
  });

  it('restores the cursor when the notation does not match', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('first-valid(red,)'),
    );

    expect(consumeFirstValid(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });
});
