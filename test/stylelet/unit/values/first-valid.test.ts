import { describe, expect, it } from 'vitest';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import {
  isTokenKind,
} from '../../../../src/stylelet/syntax/component-value';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { TokenKind } from '../../../../src/stylelet/syntax/tokens';
import {
  FirstValidValue,
} from '../../../../src/stylelet/values/substitution/first-valid';

describe('<first-valid()>', () => {
  it('parses a nonempty comma-separated list of declaration values', () => {
    const value = FirstValidValue.parse('first-valid(red, 1px, rgb(0, 0, 0))', {});

    expect(value).toBeInstanceOf(FirstValidValue);
    expect(value?.repr.map((argument) =>
      argument.serialize()
    )).toEqual(['red', '1px', 'rgb(0, 0, 0)']);
  });

  it('matches the function name case-insensitively with outer trivia', () => {
    expect(FirstValidValue.parse('  FIRST-VALID(red)  ', {})).toBeInstanceOf(FirstValidValue);
  });

  it('uses braces to bound an argument containing top-level commas', () => {
    const value = FirstValidValue.parse('first-valid({Times, serif}, sans-serif)', {});

    expect(value?.repr.map((argument) =>
      argument.serialize()
    )).toEqual(['Times, serif', 'sans-serif']);
  });

  it('allows braces around an argument that does not require them', () => {
    const value = FirstValidValue.parse('first-valid({red}, blue)', {});

    expect(value?.repr.map((argument) =>
      argument.serialize()
    )).toEqual(['red', 'blue']);
    expect(value!.serialize()).toBe('first-valid(red, blue)');
  });

  it('preserves braces required to bound a free-form argument', () => {
    const value = FirstValidValue.parse('first-valid({Times, serif}, sans-serif)', {});

    expect(value!.serialize())
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
    expect(FirstValidValue.parse(input, {})).toBeNull();
  });

  it('consumes one notation without consuming following input', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('first-valid(red, blue) trailing', {}), {},
    );

    expect(FirstValidValue.consume(c)).toBeInstanceOf(FirstValidValue);
    expect(isTokenKind(c.peek(), TokenKind.Whitespace)).toBe(true);
  });

  it('restores the cursor when the notation does not match', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('first-valid(red,)', {}), {},
    );

    expect(FirstValidValue.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });
});
