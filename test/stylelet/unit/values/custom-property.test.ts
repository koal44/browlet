import { OptionalDeclarationValue } from '../../../../src/stylelet/values/declaration-value';
import { RawWholeValue } from '../../../../src/stylelet/values/whole-value';
import { CssWideValue } from '../../../../src/stylelet/values/css-wide';
import { IdentValue } from '../../../../src/stylelet/values/ident';
import { CustomIdentValue } from '../../../../src/stylelet/values/custom-ident';
import { ColorValue } from '../../../../src/stylelet/values/color';
import { SyntaxListValue } from '../../../../src/stylelet/values/syntax-value';
import { NumberLiteral } from '../../../../src/stylelet/values/numeric-literal/number';
import { FirstValidValue } from '../../../../src/stylelet/values/substitution/first-valid';
import { guaranteedInvalidValue } from '../../../../src/stylelet/values/guaranteed-invalid';
import { describe, expect, it } from 'vitest';

import type { CustomPropertyRegistration, CustomPropertyRegistry, PropertyContext } from '../../../../src/stylelet/props/property';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { ColorKind } from '../../../../src/stylelet/values/color';
import { CSS_WIDE_KEYWORDS } from '../../../../src/stylelet/values/css-wide';
import { WholeValue } from '../../../../src/stylelet/values/whole-value';
import { SyntaxValue } from '../../../../src/stylelet/values/syntax-value';

function syntax(input: string): SyntaxValue {
  const value = SyntaxValue.parse(input, {});
  expect(value).not.toBeNull();
  return value!;
}

describe('custom property', () => {
  it('retains a multiplied syntax value when its items do not change', () => {
    const parsed = syntax('<number>+').createParser()('1 2', {})!;

    expect(parsed.resolve(ValueStage.Computed, {})).toBe(parsed);
    expect(parsed.serialize()).toBe('1 2');
  });

  it('holds a compiled parser and initial whole value in a registration', () => {
    const syntaxValue = syntax('<color>');
    const parseValue = WholeValue.createParser(syntaxValue.createParser(), true);
    const initialValue = parseValue('red', {})!;
    const registration: CustomPropertyRegistration = {
      name: '--accent',
      syntax: syntaxValue,
      parse: parseValue,
      inherits: false,
      initialValue,
    };
    const registry: CustomPropertyRegistry = new Map([
      [registration.name, registration],
    ]);

    expect(registry.get('--accent')).toBe(registration);
    expect(registration.initialValue.serialize()).toBe('red');
  });

  it('defers registered syntax validation until the computed stage', () => {
    const parseValue = WholeValue.createParser(syntax('<color>').createParser(), true);

    for (const input of ['red', '10px']) {
      const raw = parseValue(input, {})!;
      const value = raw.resolve(ValueStage.Specified, {});

      expect(value).toBe(raw);
      expect(value.value).toBeInstanceOf(RawWholeValue);
      expect(value.serialize()).toBe(input);
      expect(value.resolve(ValueStage.Specified, {})).toBe(value);
    }
  });

  it('does not consult registered grammar dependencies before the computed stage', () => {
    const parseValue = WholeValue.createParser(syntax('<number>').createParser(), true);
    const unavailable: PropertyContext = {
      get numericVariables(): never {
        throw new Error('Numeric bindings are not available before Computed');
      },
    };
    const declared = parseValue('calc(progress)', unavailable)!;

    for (const stage of [ValueStage.Declared, ValueStage.Cascaded, ValueStage.Specified]) {
      expect(declared.resolve(stage, unavailable)).toBe(declared);
    }
    expect(declared.serialize()).toBe('calc(progress)');

    const computed = declared.resolve(ValueStage.Computed, {
      numericVariables: new Map([['progress', {
        valueType: 'number',
        value: new NumberLiteral(0.5),
      }]]),
    });
    expect(computed.serialize()).toBe('0.5');
  });

  it('represents a custom property requiring substitution as a substitution value', () => {
    const parseValue = WholeValue.createParser(syntax('<color>').createParser(), true);
    const value = parseValue('var(--color)', {})!;

    expect(value).toHaveProperty('value.value', expect.any(OptionalDeclarationValue));
    expect(value.serialize()).toBe('var(--color)');
    expect(value.resolve(ValueStage.Specified, {})).toBe(value);
  });

  it('distinguishes an empty custom property from the guaranteed-invalid value', () => {
    const parseValue = WholeValue.createParser(syntax('*').createParser(), true);
    const value = parseValue('', {})!;

    expect(value).toMatchObject({
      value: {
        value: {
          value: { tokens: [] },
        },
      },
    });
    expect(value.serialize()).toBe('');
    expect(value.value).not.toBe(guaranteedInvalidValue);
    expect(value.resolve(ValueStage.Computed, {}).value).toBeInstanceOf(OptionalDeclarationValue);
    expect(guaranteedInvalidValue.serialize()).toBe('');
  });

  it('rejects an invalid nonempty declaration value', () => {
    const parseValue = WholeValue.createParser(syntax('*').createParser(), true);

    expect(parseValue('red ! blue', {})).toBeNull();
  });

  // CSS Properties and Values API 1, 2.3. Specified Value-Time Behavior
  it.each(CSS_WIDE_KEYWORDS)(
    'accepts the CSS-wide keyword %s independently of registered syntax',
    (keyword) => {
      const parseValue = WholeValue.createParser(syntax('<color>').createParser(), true);
      const value = parseValue(keyword, {})!;

      expect(value).toMatchObject({ value: new CssWideValue(keyword) });
    },
  );

  // CSS Properties and Values API 1, 2.4. Computed Value-Time Behavior
  it('parses a valid registered value at the computed stage', () => {
    const parseValue = WholeValue.createParser(syntax('<color>').createParser(), true);
    const value = parseValue('red', {})!;

    expect(value.resolve(ValueStage.Computed, {})).toMatchObject({
      value: {
        value: {
          kind: ColorKind.Absolute,
        },
      },
    });
  });

  it('tries deferred alternatives against registered syntax at the computed stage', () => {
    const parseValue = WholeValue.createParser(syntax('<color>').createParser(), true);
    const value = parseValue('first-valid(10px, red)', {})!;

    expect(value.value).toBeInstanceOf(FirstValidValue);
    expect(value.resolve(ValueStage.Specified, {})).toBe(value);
    const computed = value.resolve(ValueStage.Computed, {});
    expect(computed.serialize()).toBe('rgb(255, 0, 0)');
  });

  it.each([
    ['<number>', 'calc(1 + 2)', {}, '3'],
    ['<integer>', 'calc(1 + 2)', {}, '3'],
    ['<percentage>', 'calc(10% + 20%)', {}, '30%'],
    ['<length>', 'calc(2em)', { length: { em: 16 } }, '32px'],
    ['<length-percentage>', 'calc(2em)', { length: { em: 16 } }, '32px'],
    ['<angle>', 'calc(0.5turn)', {}, '180deg'],
    ['<time>', 'calc(250ms)', {}, '0.25s'],
    ['<resolution>', 'calc(96dpi)', {}, '1dppx'],
  ] as const)(
    'parses, resolves, and serializes calculated %s value %s',
    (syntaxText, input, context, serialized) => {
      const parseValue = WholeValue.createParser(syntax(syntaxText).createParser(), true);
      const declared = parseValue(input, context)!;
      const computed = declared.resolve(ValueStage.Computed, context);

      expect(declared.serialize()).toBe(input);
      expect(computed.serialize()).toBe(serialized);
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
        const parseValue = WholeValue.createParser(syntax(syntaxText).createParser(), true);
        const declared = parseValue(input, {})!;
        const computed = declared.resolve(ValueStage.Computed, context);

        expect(declared.serialize()).toBe(input);
        expect(computed.serialize()).toBe(serialized);
      },
    );
  }

  it('resolves and serializes a registered color with property context', () => {
    const parseValue = WholeValue.createParser(syntax('<color>').createParser(), true);
    const declared = parseValue('light-dark(white, black)', {})!;
    const computed = declared.resolve(ValueStage.Computed, { colorScheme: 'dark' });

    expect(computed.serialize()).toBe('rgb(0, 0, 0)');
  });

  it('resolves and serializes every item in a multiplied syntax value', () => {
    const parseValue = WholeValue.createParser(syntax('<color>#').createParser(), true);
    const declared = parseValue('light-dark(white, black), light-dark(red, blue)', {})!;
    const computed = declared.resolve(ValueStage.Computed, { colorScheme: 'dark' });

    expect(computed.serialize())
      .toBe('rgb(0, 0, 0), rgb(0, 0, 255)');
  });

  it.each([
    ['<number>', '5', '5'],
    ['<integer>', '5', '5'],
    ['<percentage>', '20%', '20%'],
    ['<string>', '"hello"', '"hello"'],
    ['<custom-ident>', 'hello', 'hello'],
    ['<url>', 'url("https://example.com/image.png")', 'url("https://example.com/image.png")'],
    ['*', '10px / anything', '10px / anything'],
  ])(
    'computes the registered %s literal %s as specified',
    (syntaxText, input, serialized) => {
      const parseValue = WholeValue.createParser(syntax(syntaxText).createParser(), true);
      const raw = parseValue(input, {})!;
      const computed = raw.resolve(ValueStage.Computed, { URL });

      expect(computed.serialize()).toBe(serialized);
    },
  );

  it('computes a registered image value', () => {
    const parseValue = WholeValue.createParser(syntax('<image>').createParser(), true);
    const raw = parseValue('linear-gradient(red, blue)', {})!;
    const computed = raw.resolve(ValueStage.Computed, {});

    expect(computed.serialize())
      .toBe('linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))');
  });

  it('resolves a relative registered URL against its stylesheet', () => {
    const parseValue = WholeValue.createParser(syntax('<url>').createParser(), true);
    const context: PropertyContext = {
      URL,
      baseUrl: new URL('https://example.com/styles/site.css'),
    };
    const raw = parseValue('url("image.png")', {})!;
    const computed = raw.resolve(ValueStage.Computed, context);

    expect(computed.serialize())
      .toBe('url("https://example.com/styles/image.png")');
  });

  it.skip.each([
    ['<transform-function>', 'translateX(2em)', 'translateX(32px)'],
    ['<transform-list>', 'translateX(2em) rotate(0deg)', 'translateX(32px) rotate(0deg)'],
  ])(
    'computes lengths in a registered %s value',
    (syntaxText, input, serialized) => {
      const parseValue = WholeValue.createParser(syntax(syntaxText).createParser(), true);
      const raw = parseValue(input, {})!;
      const computed = raw.resolve(ValueStage.Computed, {
        length: { em: 16 },
      });

      expect(computed.serialize()).toBe(serialized);
    },
  );

  it.each([
    ['red | <color>', 'red', 'red'],
    ['<custom-ident>+', 'one two', 'one two'],
    ['*', '10px / anything', '10px / anything'],
  ])(
    'serializes %s value %s after computed-stage parsing',
    (syntaxText, input, serialized) => {
      const parseValue = WholeValue.createParser(syntax(syntaxText).createParser(), true);
      const raw = parseValue(input, {})!;
      const computed = raw.resolve(ValueStage.Computed, {});

      expect(computed.serialize()).toBe(serialized);
    },
  );

  it('makes a registered value with invalid syntax guaranteed-invalid at computation', () => {
    const parseValue = WholeValue.createParser(syntax('<color>').createParser(), true);
    const value = parseValue('10px', {})!;

    expect(value.resolve(ValueStage.Computed, {}).value).toBe(guaranteedInvalidValue);
  });

  it('returns the first syntax alternative that matches the entire value', () => {
    const parseValue = WholeValue.createParser(syntax('red | <color>').createParser(), true);
    const value = parseValue('red', {})!;

    expect(value.resolve(ValueStage.Computed, {})).toMatchObject({ value: new IdentValue('red') });
  });

  it('matches syntax keywords codepoint-wise', () => {
    const parseValue = WholeValue.createParser(syntax('Red | <color>').createParser(), true);
    const exact = parseValue('Red', {})!;
    const lower = parseValue('red', {})!;

    expect(exact.resolve(ValueStage.Computed, {})).toMatchObject({
      value: new IdentValue('Red'),
    });
    expect(lower.resolve(ValueStage.Computed, {}).value).toBeInstanceOf(ColorValue);
  });

  it('does not commit to an alternative that matches only a prefix', () => {
    const parseValue = WholeValue.createParser(syntax('auto | <custom-ident>+').createParser(), true);
    const value = parseValue('auto extra', {})!;

    expect(value.resolve(ValueStage.Computed, {})).toMatchObject({
      value: new SyntaxListValue({
        multiplier: '+', values: [
          new CustomIdentValue('auto'),
          new CustomIdentValue('extra'),
        ],
      }),
    });
  });

  it('preserves the separator and values of a multiplied syntax component', () => {
    const parseValue = WholeValue.createParser(syntax('<color>#').createParser(), true);
    const value = parseValue('red, blue', {})!;

    const computed = value.resolve(ValueStage.Computed, {}).value;
    expect(computed).toBeInstanceOf(SyntaxListValue);
    if (!(computed instanceof SyntaxListValue)) throw new Error('Expected a multiplied syntax value');
    expect(computed.value.multiplier).toBe('#');
    expect(computed.value.values).toHaveLength(2);
    for (const item of computed.value.values) expect(item).toBeInstanceOf(ColorValue);
    expect(computed.serialize()).toBe('rgb(255, 0, 0), rgb(0, 0, 255)');
  });

  it('preserves a value parsed with the universal syntax', () => {
    const parseValue = WholeValue.createParser(syntax('*').createParser(), true);
    const value = parseValue('10px / anything', {})!;

    expect(value.resolve(ValueStage.Computed, {}).value).toBeInstanceOf(OptionalDeclarationValue);
  });
});
