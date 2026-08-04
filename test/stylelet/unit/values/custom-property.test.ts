import { describe, expect, it } from 'vitest';

import { ValueStage } from '../../../../src/stylelet/value-processing';
import { ColorKind } from '../../../../src/stylelet/values/color';
import { guaranteedInvalidValue } from '../../../../src/stylelet/values/guaranteed-invalid';
import { defineCustomProperty } from '../../../../src/stylelet/values/property-value';
import { parseSyntax, type SyntaxValue } from '../../../../src/stylelet/values/syntax-value';

function syntax(input: string): SyntaxValue {
  const value = parseSyntax(input);
  expect(value).not.toBeNull();
  return value!;
}

describe('custom property', () => {
  it('defers registered syntax validation until the computed stage', () => {
    const property = defineCustomProperty({ syntax: syntax('<color>') });

    for (const input of ['red', '10px']) {
      const value = property.parse(input);

      expect(value).toMatchObject({ type: 'custom-property-value' });
      expect(value?.serialize()).toBe(input);
      expect(value?.resolve(ValueStage.Specified, {})).toBe(value);
    }
  });

  it('represents a custom property requiring substitution as a substitution value', () => {
    const property = defineCustomProperty({ syntax: syntax('<color>') });
    const value = property.parse('var(--color)');

    expect(value).toMatchObject({
      type: 'substitution-value',
      declaration: {
        type: 'declaration-value',
      },
    });
    expect(value?.serialize()).toBe('var(--color)');
    expect(value?.resolve(ValueStage.Specified, {})).toBe(value);
  });

  it('distinguishes an empty custom property from the guaranteed-invalid value', () => {
    const property = defineCustomProperty({ syntax: syntax('*') });
    const value = property.parse('');

    expect(value).toMatchObject({
      type: 'custom-property-value',
      declaration: {
        type: 'declaration-value',
        components: [],
      },
    });
    expect(value?.serialize()).toBe('');
    expect(value).not.toBe(guaranteedInvalidValue);
    expect(guaranteedInvalidValue.serialize()).toBe('');
  });

  it('rejects an invalid nonempty declaration value', () => {
    const property = defineCustomProperty({ syntax: syntax('*') });

    expect(property.parse('red ! blue')).toBeNull();
  });

  it('recognizes CSS-wide keywords independently of registered syntax', () => {
    const property = defineCustomProperty({ syntax: syntax('<color>') });

    expect(property.parse('inherit')).toMatchObject({
      type: 'css-wide',
      keyword: 'inherit',
    });
  });

  it('parses a valid registered value at the computed stage', () => {
    const property = defineCustomProperty({ syntax: syntax('<color>') });
    const value = property.parse('red');

    expect(value?.resolve(ValueStage.Computed, {})).toMatchObject({
      type: 'whole-value',
      value: {
        type: 'parsed-syntax-type',
        name: 'color',
        value: {
          kind: ColorKind.Absolute,
        },
      },
    });
  });

  it.each([
    ['<number>', 'calc(1 + 2)', {}, '3'],
    ['<length>', 'calc(2em)', { length: { em: 16 } }, '32px'],
    ['<angle>', 'calc(0.5turn)', {}, '180deg'],
    ['<time>', 'calc(250ms)', {}, '0.25s'],
    ['<resolution>', 'calc(96dpi)', {}, '1dppx'],
  ] as const)(
    'parses, resolves, and serializes calculated %s value %s',
    (syntaxText, input, context, serialized) => {
      const property = defineCustomProperty({ syntax: syntax(syntaxText) });
      const declared = property.parse(input);

      expect(declared?.serialize()).toBe(input);
      expect(declared?.resolve(ValueStage.Computed, context).serialize())
        .toBe(serialized);
    },
  );

  for (const [syntaxText, input, context, serialized] of [
    ['<length>', '2em', { length: { em: 16 } }, '32px'],
    ['<angle>', '0.5turn', {}, '180deg'],
    ['<time>', '250ms', {}, '0.25s'],
    ['<resolution>', '96dpi', {}, '1dppx'],
  ] as const) {
    it(
      `resolves and serializes literal ${syntaxText} value ${input}`,
      () => {
        const property = defineCustomProperty({ syntax: syntax(syntaxText) });
        const declared = property.parse(input);

        expect(declared?.serialize()).toBe(input);
        expect(declared?.resolve(ValueStage.Computed, context).serialize())
          .toBe(serialized);
      },
    );
  }

  it('resolves and serializes a registered color with property context', () => {
    const property = defineCustomProperty({ syntax: syntax('<color>') });
    const declared = property.parse('light-dark(white, black)');

    expect(declared?.resolve(ValueStage.Computed, { colorScheme: 'dark' }).serialize())
      .toBe('rgb(0, 0, 0)');
  });

  it('resolves and serializes every item in a multiplied syntax value', () => {
    const property = defineCustomProperty({ syntax: syntax('<color>#') });
    const declared = property.parse(
      'light-dark(white, black), light-dark(red, blue)',
    );

    expect(declared?.resolve(ValueStage.Computed, { colorScheme: 'dark' }).serialize())
      .toBe('rgb(0, 0, 0), rgb(0, 0, 255)');
  });

  it.each([
    ['red | <color>', 'red', 'red'],
    ['<custom-ident>+', 'one two', 'one two'],
    ['*', '10px / anything', '10px / anything'],
  ])(
    'serializes %s value %s after computed-stage parsing',
    (syntaxText, input, serialized) => {
      const property = defineCustomProperty({ syntax: syntax(syntaxText) });

      expect(property.parse(input)?.resolve(ValueStage.Computed, {}).serialize())
        .toBe(serialized);
    },
  );

  it('makes a registered value with invalid syntax guaranteed-invalid at computation', () => {
    const property = defineCustomProperty({ syntax: syntax('<color>') });
    const value = property.parse('10px');

    expect(value?.resolve(ValueStage.Computed, {})).toBe(guaranteedInvalidValue);
  });

  it('returns the first syntax alternative that matches the entire value', () => {
    const property = defineCustomProperty({ syntax: syntax('red | <color>') });
    const value = property.parse('red');

    expect(value?.resolve(ValueStage.Computed, {})).toMatchObject({
      type: 'whole-value',
      value: {
        type: 'parsed-syntax-keyword',
        name: 'red',
      },
    });
  });

  it('matches syntax keywords codepoint-wise', () => {
    const property = defineCustomProperty({ syntax: syntax('Red | <color>') });

    expect(property.parse('Red')?.resolve(ValueStage.Computed, {})).toMatchObject({
      value: {
        type: 'parsed-syntax-keyword',
        name: 'Red',
      },
    });
    expect(property.parse('red')?.resolve(ValueStage.Computed, {})).toMatchObject({
      value: {
        type: 'parsed-syntax-type',
        name: 'color',
      },
    });
  });

  it('does not commit to an alternative that matches only a prefix', () => {
    const property = defineCustomProperty({ syntax: syntax('auto | <custom-ident>+') });
    const value = property.parse('auto extra');

    expect(value?.resolve(ValueStage.Computed, {})).toMatchObject({
      type: 'whole-value',
      value: {
        type: 'parsed-syntax-list',
        multiplier: '+',
        values: [
          { type: 'parsed-syntax-type', name: 'custom-ident' },
          { type: 'parsed-syntax-type', name: 'custom-ident' },
        ],
      },
    });
  });

  it('preserves the separator and values of a multiplied syntax component', () => {
    const property = defineCustomProperty({ syntax: syntax('<color>#') });
    const value = property.parse('red, blue');

    expect(value?.resolve(ValueStage.Computed, {})).toMatchObject({
      type: 'whole-value',
      value: {
        type: 'parsed-syntax-list',
        multiplier: '#',
        values: [
          { type: 'parsed-syntax-type', name: 'color' },
          { type: 'parsed-syntax-type', name: 'color' },
        ],
      },
    });
  });

  it('preserves a value parsed with the universal syntax', () => {
    const property = defineCustomProperty({ syntax: syntax('*') });
    const value = property.parse('10px / anything');

    expect(value?.resolve(ValueStage.Computed, {})).toMatchObject({
      type: 'whole-value',
      value: {
        type: 'parsed-universal-syntax',
      },
    });
  });
});
