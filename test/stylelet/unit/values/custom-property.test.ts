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

import type { PropertyContext } from '../../../../src/stylelet/props/base-property';
import type { CustomPropertyRegistration, CustomPropertyRegistry } from '../../../../src/stylelet/props/registry';
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
    const parseOrdinary = syntaxValue.createParser();
    const registration: CustomPropertyRegistration = {
      name: '--accent',
      syntax: syntaxValue,
      parse: (input, context) => WholeValue.parse(input, context, parseOrdinary, true),
      inherits: false,
      initialValue: WholeValue.parse('red', {}, parseOrdinary, true)!,
    };
    const registry: CustomPropertyRegistry = new Map([
      [registration.name, registration],
    ]);

    expect(registry.get('--accent')).toBe(registration);
    expect(registration.initialValue.serialize()).toBe('red');
  });

  it('defers registered syntax validation until the computed stage', () => {
    const parseOrdinary = syntax('<color>').createParser();

    for (const input of ['red', '10px']) {
      const raw = WholeValue.parse(input, {}, parseOrdinary, true)!;
      const value = raw.resolve(ValueStage.Specified, {});

      expect(value).toBe(raw);
      expect(value.inner).toBeInstanceOf(RawWholeValue);
      expect(value.serialize()).toBe(input);
      expect(value.resolve(ValueStage.Specified, {})).toBe(value);
    }
  });

  it('does not consult registered grammar dependencies before the computed stage', () => {
    const parseOrdinary = syntax('<number>').createParser();
    const unavailable: PropertyContext = {
      get numericVariables(): never {
        throw new Error('Numeric bindings are not available before Computed');
      },
    };
    const declared = WholeValue.parse('calc(progress)', unavailable, parseOrdinary, true)!;

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
    const parseOrdinary = syntax('<color>').createParser();
    const value = WholeValue.parse('var(--color)', {}, parseOrdinary, true)!;

    expect(value).toHaveProperty('inner.repr', expect.any(OptionalDeclarationValue));
    expect(value.serialize()).toBe('var(--color)');
    expect(value.resolve(ValueStage.Specified, {})).toBe(value);
  });

  it('distinguishes an empty custom property from the guaranteed-invalid value', () => {
    const parseOrdinary = syntax('*').createParser();
    const value = WholeValue.parse('', {}, parseOrdinary, true)!;

    expect(value).toMatchObject({
      inner: {
        repr: {
          repr: { tokens: [] },
        },
      },
    });
    expect(value.serialize()).toBe('');
    expect(value.inner).not.toBe(guaranteedInvalidValue);
    expect(value.resolve(ValueStage.Computed, {}).inner).toBeInstanceOf(OptionalDeclarationValue);
    expect(guaranteedInvalidValue.serialize()).toBe('');
  });

  it('rejects an invalid nonempty declaration value', () => {
    const parseOrdinary = syntax('*').createParser();

    expect(WholeValue.parse('red ! blue', {}, parseOrdinary, true)).toBeNull();
  });

  // CSS Properties and Values API 1, 2.3. Specified Value-Time Behavior
  it.each(CSS_WIDE_KEYWORDS)(
    'accepts the CSS-wide keyword %s independently of registered syntax',
    (keyword) => {
      const parseOrdinary = syntax('<color>').createParser();
      const value = WholeValue.parse(keyword, {}, parseOrdinary, true)!;

      expect(value).toMatchObject({ inner: new CssWideValue(keyword) });
    },
  );

  // CSS Properties and Values API 1, 2.4. Computed Value-Time Behavior
  it('parses a valid registered value at the computed stage', () => {
    const parseOrdinary = syntax('<color>').createParser();
    const value = WholeValue.parse('red', {}, parseOrdinary, true)!;

    expect(value.resolve(ValueStage.Computed, {})).toMatchObject({
      inner: {
        repr: {
          kind: ColorKind.Absolute,
        },
      },
    });
  });

  it('tries deferred alternatives against registered syntax at the computed stage', () => {
    const parseOrdinary = syntax('<color>').createParser();
    const value = WholeValue.parse('first-valid(10px, red)', {}, parseOrdinary, true)!;

    expect(value.inner).toBeInstanceOf(FirstValidValue);
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
      const parseOrdinary = syntax(syntaxText).createParser();
      const declared = WholeValue.parse(input, context, parseOrdinary, true)!;
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
        const parseOrdinary = syntax(syntaxText).createParser();
        const declared = WholeValue.parse(input, {}, parseOrdinary, true)!;
        const computed = declared.resolve(ValueStage.Computed, context);

        expect(declared.serialize()).toBe(input);
        expect(computed.serialize()).toBe(serialized);
      },
    );
  }

  it('resolves and serializes a registered color with property context', () => {
    const parseOrdinary = syntax('<color>').createParser();
    const declared = WholeValue.parse('light-dark(white, black)', {}, parseOrdinary, true)!;
    const computed = declared.resolve(ValueStage.Computed, { colorScheme: 'dark' });

    expect(computed.serialize()).toBe('rgb(0, 0, 0)');
  });

  it('resolves and serializes every item in a multiplied syntax value', () => {
    const parseOrdinary = syntax('<color>#').createParser();
    const declared = WholeValue.parse('light-dark(white, black), light-dark(red, blue)', {}, parseOrdinary, true)!;
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
      const parseOrdinary = syntax(syntaxText).createParser();
      const raw = WholeValue.parse(input, {}, parseOrdinary, true)!;
      const computed = raw.resolve(ValueStage.Computed, { URL });

      expect(computed.serialize()).toBe(serialized);
    },
  );

  it('computes a registered image value', () => {
    const parseOrdinary = syntax('<image>').createParser();
    const raw = WholeValue.parse('linear-gradient(red, blue)', {}, parseOrdinary, true)!;
    const computed = raw.resolve(ValueStage.Computed, {});

    expect(computed.serialize())
      .toBe('linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))');
  });

  it('resolves a relative registered URL against its stylesheet', () => {
    const parseOrdinary = syntax('<url>').createParser();
    const context: PropertyContext = {
      URL,
      baseUrl: new URL('https://example.com/styles/site.css'),
    };
    const raw = WholeValue.parse('url("image.png")', {}, parseOrdinary, true)!;
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
      const parseOrdinary = syntax(syntaxText).createParser();
      const raw = WholeValue.parse(input, {}, parseOrdinary, true)!;
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
      const parseOrdinary = syntax(syntaxText).createParser();
      const raw = WholeValue.parse(input, {}, parseOrdinary, true)!;
      const computed = raw.resolve(ValueStage.Computed, {});

      expect(computed.serialize()).toBe(serialized);
    },
  );

  it('makes a registered value with invalid syntax guaranteed-invalid at computation', () => {
    const parseOrdinary = syntax('<color>').createParser();
    const value = WholeValue.parse('10px', {}, parseOrdinary, true)!;

    expect(value.resolve(ValueStage.Computed, {}).inner).toBe(guaranteedInvalidValue);
  });

  it('returns the first syntax alternative that matches the entire value', () => {
    const parseOrdinary = syntax('red | <color>').createParser();
    const value = WholeValue.parse('red', {}, parseOrdinary, true)!;

    expect(value.resolve(ValueStage.Computed, {})).toMatchObject({ inner: new IdentValue('red') });
  });

  it('matches syntax keywords codepoint-wise', () => {
    const parseOrdinary = syntax('Red | <color>').createParser();
    const exact = WholeValue.parse('Red', {}, parseOrdinary, true)!;
    const lower = WholeValue.parse('red', {}, parseOrdinary, true)!;

    expect(exact.resolve(ValueStage.Computed, {})).toMatchObject({
      inner: new IdentValue('Red'),
    });
    expect(lower.resolve(ValueStage.Computed, {}).inner).toBeInstanceOf(ColorValue);
  });

  it('does not commit to an alternative that matches only a prefix', () => {
    const parseOrdinary = syntax('auto | <custom-ident>+').createParser();
    const value = WholeValue.parse('auto extra', {}, parseOrdinary, true)!;

    expect(value.resolve(ValueStage.Computed, {})).toMatchObject({
      inner: new SyntaxListValue({
        multiplier: '+', values: [
          new CustomIdentValue('auto'),
          new CustomIdentValue('extra'),
        ],
      }),
    });
  });

  it('preserves the separator and values of a multiplied syntax component', () => {
    const parseOrdinary = syntax('<color>#').createParser();
    const value = WholeValue.parse('red, blue', {}, parseOrdinary, true)!;

    const computed = value.resolve(ValueStage.Computed, {}).inner;
    expect(computed).toBeInstanceOf(SyntaxListValue);
    if (!(computed instanceof SyntaxListValue)) throw new Error('Expected a multiplied syntax value');
    expect(computed.repr.multiplier).toBe('#');
    expect(computed.repr.values).toHaveLength(2);
    for (const item of computed.repr.values) expect(item).toBeInstanceOf(ColorValue);
    expect(computed.serialize()).toBe('rgb(255, 0, 0), rgb(0, 0, 255)');
  });

  it('preserves a value parsed with the universal syntax', () => {
    const parseOrdinary = syntax('*').createParser();
    const value = WholeValue.parse('10px / anything', {}, parseOrdinary, true)!;

    expect(value.resolve(ValueStage.Computed, {}).inner).toBeInstanceOf(OptionalDeclarationValue);
  });
});
