import { describe, expect, it } from 'vitest';

import type {
  CustomPropertyRegistration, CustomPropertyRegistry, PropertyContext,
} from '../../../../src/stylelet/props/property';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { ColorKind } from '../../../../src/stylelet/values/color';
import { CSS_WIDE_KEYWORDS } from '../../../../src/stylelet/values/css-wide';
import { defineCustomWholeValue, guaranteedInvalidValue } from '../../../../src/stylelet/values/whole-value';
import { parseSyntax, type SyntaxValue } from '../../../../src/stylelet/values/syntax-value';

function syntax(input: string): SyntaxValue {
  const value = parseSyntax(input, {});
  expect(value).not.toBeNull();
  return value!;
}

describe('custom property', () => {
  it('holds a synthesized definition and initial whole value in a registration', () => {
    const syntaxValue = syntax('<color>');
    const definition = defineCustomWholeValue({ syntax: syntaxValue });
    const initialValue = definition.parse('red', {})!;
    const registration: CustomPropertyRegistration = {
      name: '--accent',
      syntax: syntaxValue,
      definition,
      inherits: false,
      initialValue,
    };
    const registry: CustomPropertyRegistry = new Map([
      [registration.name, registration],
    ]);

    expect(registry.get('--accent')).toBe(registration);
    expect(definition.serialize(registration.initialValue)).toBe('red');
  });

  it('defers registered syntax validation until the computed stage', () => {
    const property = defineCustomWholeValue({ syntax: syntax('<color>') });

    for (const input of ['red', '10px']) {
      const raw = property.parse(input, {})!;
      const value = property.resolve(raw, ValueStage.Specified, {});

      expect(value).toBe(raw);
      expect(value).toMatchObject({ type: 'raw' });
      expect(property.serialize(value)).toBe(input);
      expect(property.resolve(value, ValueStage.Specified, {})).toBe(value);
    }
  });

  it('does not consult registered grammar dependencies before the computed stage', () => {
    const property = defineCustomWholeValue({ syntax: syntax('<number>') });
    const unavailable: PropertyContext = {
      get numericVariables(): never {
        throw new Error('Numeric bindings are not available before Computed');
      },
    };
    const declared = property.parse('calc(progress)', unavailable)!;

    for (const stage of [ValueStage.Declared, ValueStage.Cascaded, ValueStage.Specified]) {
      expect(property.resolve(declared, stage, unavailable)).toBe(declared);
    }
    expect(property.serialize(declared)).toBe('calc(progress)');

    const computed = property.resolve(declared, ValueStage.Computed, {
      numericVariables: new Map([['progress', {
        valueType: 'number',
        value: { type: 'number', value: 0.5 },
      }]]),
    });
    expect(property.serialize(computed)).toBe('0.5');
  });

  it('represents a custom property requiring substitution as a substitution value', () => {
    const property = defineCustomWholeValue({ syntax: syntax('<color>') });
    const value = property.parse('var(--color)', {})!;

    expect(value).toMatchObject({
      type: 'substitution-value',
      declaration: {
        type: 'declaration-value',
      },
    });
    expect(property.serialize(value)).toBe('var(--color)');
    expect(property.resolve(value, ValueStage.Specified, {})).toBe(value);
  });

  it('distinguishes an empty custom property from the guaranteed-invalid value', () => {
    const property = defineCustomWholeValue({ syntax: syntax('*') });
    const value = property.parse('', {})!;

    expect(value).toMatchObject({
      type: 'raw',
      declaration: {
        type: 'declaration-value',
        components: { tokens: [] },
      },
    });
    expect(property.serialize(value)).toBe('');
    expect(value).not.toBe(guaranteedInvalidValue);
    expect(property.serialize(guaranteedInvalidValue)).toBe('');
  });

  it('rejects an invalid nonempty declaration value', () => {
    const property = defineCustomWholeValue({ syntax: syntax('*') });

    expect(property.parse('red ! blue', {})).toBeNull();
  });

  // CSS Properties and Values API 1, 2.3. Specified Value-Time Behavior
  it.each(CSS_WIDE_KEYWORDS)(
    'accepts the CSS-wide keyword %s independently of registered syntax',
    (keyword) => {
      const property = defineCustomWholeValue({ syntax: syntax('<color>') });
      const value = property.parse(keyword, {})!;

      expect(value).toMatchObject({
        type: 'css-wide',
        keyword,
      });
    },
  );

  // CSS Properties and Values API 1, 2.4. Computed Value-Time Behavior
  it('parses a valid registered value at the computed stage', () => {
    const property = defineCustomWholeValue({ syntax: syntax('<color>') });
    const value = property.parse('red', {})!;

    expect(property.resolve(value, ValueStage.Computed, {})).toMatchObject({
      type: 'ordinary',
      value: {
        type: 'parsed-syntax-type',
        name: 'color',
        value: {
          kind: ColorKind.Absolute,
        },
      },
    });
  });

  it('tries deferred alternatives against registered syntax at the computed stage', () => {
    const property = defineCustomWholeValue({ syntax: syntax('<color>') });
    const value = property.parse('first-valid(10px, red)', {})!;

    expect(value.type).toBe('first-valid');
    expect(property.resolve(value, ValueStage.Specified, {})).toBe(value);
    const computed = property.resolve(value, ValueStage.Computed, {});
    expect(property.serialize(computed)).toBe('rgb(255, 0, 0)');
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
      const property = defineCustomWholeValue({ syntax: syntax(syntaxText) });
      const declared = property.parse(input, context)!;
      const computed = property.resolve(declared, ValueStage.Computed, context);

      expect(property.serialize(declared)).toBe(input);
      expect(property.serialize(computed)).toBe(serialized);
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
        const property = defineCustomWholeValue({ syntax: syntax(syntaxText) });
        const declared = property.parse(input, {})!;
        const computed = property.resolve(declared, ValueStage.Computed, context);

        expect(property.serialize(declared)).toBe(input);
        expect(property.serialize(computed)).toBe(serialized);
      },
    );
  }

  it('resolves and serializes a registered color with property context', () => {
    const property = defineCustomWholeValue({ syntax: syntax('<color>') });
    const declared = property.parse('light-dark(white, black)', {})!;
    const computed = property.resolve(declared, ValueStage.Computed, { colorScheme: 'dark' });

    expect(property.serialize(computed)).toBe('rgb(0, 0, 0)');
  });

  it('resolves and serializes every item in a multiplied syntax value', () => {
    const property = defineCustomWholeValue({ syntax: syntax('<color>#') });
    const declared = property.parse(
      'light-dark(white, black), light-dark(red, blue)', {},
    )!;
    const computed = property.resolve(declared, ValueStage.Computed, { colorScheme: 'dark' });

    expect(property.serialize(computed))
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
      const property = defineCustomWholeValue({ syntax: syntax(syntaxText) });
      const raw = property.parse(input, {})!;
      const computed = property.resolve(raw, ValueStage.Computed, { URL });

      expect(property.serialize(computed)).toBe(serialized);
    },
  );

  it('computes a registered image value', () => {
    const property = defineCustomWholeValue({ syntax: syntax('<image>') });
    const raw = property.parse('linear-gradient(red, blue)', {})!;
    const computed = property.resolve(raw, ValueStage.Computed, {});

    expect(property.serialize(computed))
      .toBe('linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))');
  });

  it('resolves a relative registered URL against its stylesheet', () => {
    const property = defineCustomWholeValue({ syntax: syntax('<url>') });
    const context: PropertyContext = {
      URL,
      baseUrl: new URL('https://example.com/styles/site.css'),
    };
    const raw = property.parse('url("image.png")', {})!;
    const computed = property.resolve(raw, ValueStage.Computed, context);

    expect(property.serialize(computed))
      .toBe('url("https://example.com/styles/image.png")');
  });

  it.skip.each([
    ['<transform-function>', 'translateX(2em)', 'translateX(32px)'],
    ['<transform-list>', 'translateX(2em) rotate(0deg)', 'translateX(32px) rotate(0deg)'],
  ])(
    'computes lengths in a registered %s value',
    (syntaxText, input, serialized) => {
      const property = defineCustomWholeValue({ syntax: syntax(syntaxText) });
      const raw = property.parse(input, {})!;
      const computed = property.resolve(raw, ValueStage.Computed, {
        length: { em: 16 },
      });

      expect(property.serialize(computed)).toBe(serialized);
    },
  );

  it.each([
    ['red | <color>', 'red', 'red'],
    ['<custom-ident>+', 'one two', 'one two'],
    ['*', '10px / anything', '10px / anything'],
  ])(
    'serializes %s value %s after computed-stage parsing',
    (syntaxText, input, serialized) => {
      const property = defineCustomWholeValue({ syntax: syntax(syntaxText) });
      const raw = property.parse(input, {})!;
      const computed = property.resolve(raw, ValueStage.Computed, {});

      expect(property.serialize(computed)).toBe(serialized);
    },
  );

  it('makes a registered value with invalid syntax guaranteed-invalid at computation', () => {
    const property = defineCustomWholeValue({ syntax: syntax('<color>') });
    const value = property.parse('10px', {})!;

    expect(property.resolve(value, ValueStage.Computed, {})).toBe(guaranteedInvalidValue);
  });

  it('returns the first syntax alternative that matches the entire value', () => {
    const property = defineCustomWholeValue({ syntax: syntax('red | <color>') });
    const value = property.parse('red', {})!;

    expect(property.resolve(value, ValueStage.Computed, {})).toMatchObject({
      type: 'ordinary',
      value: {
        type: 'parsed-syntax-keyword',
        name: 'red',
      },
    });
  });

  it('matches syntax keywords codepoint-wise', () => {
    const property = defineCustomWholeValue({ syntax: syntax('Red | <color>') });
    const exact = property.parse('Red', {})!;
    const lower = property.parse('red', {})!;

    expect(property.resolve(exact, ValueStage.Computed, {})).toMatchObject({
      value: {
        type: 'parsed-syntax-keyword',
        name: 'Red',
      },
    });
    expect(property.resolve(lower, ValueStage.Computed, {})).toMatchObject({
      value: {
        type: 'parsed-syntax-type',
        name: 'color',
      },
    });
  });

  it('does not commit to an alternative that matches only a prefix', () => {
    const property = defineCustomWholeValue({ syntax: syntax('auto | <custom-ident>+') });
    const value = property.parse('auto extra', {})!;

    expect(property.resolve(value, ValueStage.Computed, {})).toMatchObject({
      type: 'ordinary',
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
    const property = defineCustomWholeValue({ syntax: syntax('<color>#') });
    const value = property.parse('red, blue', {})!;

    expect(property.resolve(value, ValueStage.Computed, {})).toMatchObject({
      type: 'ordinary',
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
    const property = defineCustomWholeValue({ syntax: syntax('*') });
    const value = property.parse('10px / anything', {})!;

    expect(property.resolve(value, ValueStage.Computed, {})).toMatchObject({
      type: 'ordinary',
      value: {
        type: 'parsed-universal-syntax',
      },
    });
  });
});
