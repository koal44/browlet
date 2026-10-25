import { styleletEnv } from '../../environment-fixture';
import { OptionalDeclarationValue } from '../../../../src/stylelet/values/declaration-value';
import { BooleanExprValue } from '../../../../src/stylelet/values/boolean-expr';
import { SupportsConditionValue } from '../../../../src/stylelet/values/supports-condition';
import { guaranteedInvalidValue } from '../../../../src/stylelet/values/guaranteed-invalid';
import { describe, expect, it, vi } from 'vitest';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import type { PropertyContext } from '../../../../src/stylelet/props/base-property';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import {
  IfValue, IfArguments,
} from '../../../../src/stylelet/values/substitution/if';
import {
  WholeValue,
} from '../../../../src/stylelet/values/whole-value';
import { SyntaxValue } from '../../../../src/stylelet/values/syntax-value';

describe('<if()>', () => {
  it('parses a nonempty semicolon-separated branch list', () => {
    const value = IfValue.parse('if(future(): red; else: blue;)', {});

    expect(value?.repr[0].condition).toBeInstanceOf(BooleanExprValue);
    expect(value?.repr[1]?.condition).toEqual({ type: 'else' });
    for (const branch of value!.repr) {
      expect(branch.value).toBeInstanceOf(OptionalDeclarationValue);
    }
    expect(value?.repr.map(({ value: branchValue }) =>
      branchValue.serialize().trim()
    )).toEqual(['red', 'blue']);
  });

  it('parses Boolean expressions around supports tests', () => {
    const parsed = IfValue.parse('if(not supports(display: grid): red; else: blue)', {})!;
    const condition = parsed.repr[0].condition;
    if (!(condition instanceof BooleanExprValue)) throw new Error('Expected a boolean condition');
    expect(condition.evaluate({ evaluateTest: () => true })).toBe(false);
    expect(parsed.repr[1]!.condition).toEqual({ type: 'else' });
  });

  it('parses a supports condition as a supports test', () => {
    const parsed = IfValue.parse('if(supports((display: grid) and (color: red)): yes; else: no)', {})!;
    const condition = parsed.repr[0].condition;
    if (!(condition instanceof BooleanExprValue)) throw new Error('Expected a boolean condition');
    const supports = vi.fn(() => true);
    expect(condition.evaluate({
      evaluateTest: (test) => {
        expect(test.condition).toBeInstanceOf(SupportsConditionValue);
        return test.condition instanceof SupportsConditionValue && test.condition.evaluate({ env: styleletEnv, supports });
      },
    })).toBe(true);
    expect(supports.mock.calls).toHaveLength(2);
  });

  it.each(['media(width > 10px)', 'style(--scheme: dark)'])(
    'retains unsupported %s as general-enclosed',
    (test) => {
      const condition = IfValue.parse(`if(${test}: yes; else: no)`, {})!.repr[0].condition;
      if (!(condition instanceof BooleanExprValue)) throw new Error('Expected a boolean condition');
      const evaluateTest = vi.fn(() => true);
      expect(condition.evaluate({ evaluateTest, preserveUnknown: true })).toBe('unknown');
      expect(evaluateTest).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['if(else:)', false],
    ['if(else:;)', false],
    ['if(else:{})', false],
    ['if(else: red)', true],
  ])('parses an optional branch value in %j', (input, hasComponents) => {
    const value = IfValue.parse(input, {});

    expect(value).not.toBeNull();
    const { value: declaration } = value!.repr[0];
    expect(declaration.repr.tokens.length > 0).toBe(hasComponents);
  });

  it('uses braces to bound a value containing a top-level comma', () => {
    const value = IfValue.parse('if(else: {Times, serif})', {});

    expect(value!.repr[0].value.serialize())
      .toBe('Times, serif');
  });

  it.each([
    'if()',
    'if(else)',
    'if(: red)',
    'if(else: red, blue)',
    'if(else: red;; else: blue)',
    'if(else: red ! blue)',
  ])('rejects %j', (input) => {
    expect(IfValue.parse(input, {})).toBeNull();
  });

  it('consumes one notation without consuming following input', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('if(else: red) trailing', {}), {},
    );

    expect(IfValue.consume(c)).toBeInstanceOf(IfValue);
    expect(c.pos()).toBe(1);
  });
});

describe('<if-args>', () => {
  it('divides branches without parsing their conditions', () => {
    const value = IfArguments.parse('if(var(--condition): var(--when-true); else: var(--fallback))', {});

    expect(value?.value.map(({ condition, value: branchValue }) => [
      condition.serialize().trim(),
      branchValue.serialize().trim(),
    ])).toEqual([
      ['var(--condition)', 'var(--when-true)'],
      ['else', 'var(--fallback)'],
    ]);
  });

  it('requires the literal colon and semicolon branch boundaries', () => {
    expect(IfArguments.parse('if(var(--branch); else: green;)', {})).toBeNull();
  });
});

describe('if() replacement', () => {
  const parseOrdinary = SyntaxValue.parse('<color>', {})!.createParser();

  function resolve(input: string, context: PropertyContext = { env: styleletEnv }) {
    const raw = WholeValue.parse(input, context, parseOrdinary, true);
    return raw === null ? null : raw.resolve(ValueStage.Computed, context);
  }

  it.fails('selects the first branch whose supports test is true', () => {
    const supports = vi.fn(({ name }) => name === 'color');
    const value = resolve(
      'if(supports(color: red): red; supports(width: 10px): blue; else: black)',
      { env: styleletEnv, supports },
    );

    expect(value!.serialize()).toBe('rgb(255, 0, 0)');
    expect(supports).toHaveBeenCalledTimes(1);
  });

  it.fails('falls through a false supports test to else', () => {
    const supports = vi.fn(() => false);
    const value = resolve(
      'if(supports(color: red): blue; else: red)',
      { env: styleletEnv, supports },
    );

    expect(value!.serialize()).toBe('rgb(255, 0, 0)');
    expect(supports).toHaveBeenCalledTimes(1);
  });

  it.fails('treats general-enclosed syntax inside supports as false', () => {
    const supports = vi.fn(() => true);
    const value = resolve(
      'if(not supports(future(feature)): red; else: blue)',
      { env: styleletEnv, supports },
    );

    expect(value!.serialize()).toBe('rgb(255, 0, 0)');
    expect(supports).not.toHaveBeenCalled();
  });

  it.fails('skips a condition that does not parse after substitution', () => {
    const value = resolve('if(not-a-condition: blue; else: red)', { env: styleletEnv })!;
    expect(value.serialize()).toBe('rgb(255, 0, 0)');
  });

  it.fails('does not substitute the value of a false branch', () => {
    const value = resolve('if(future(): var(--missing); else: red)', { env: styleletEnv })!;
    expect(value.serialize()).toBe('rgb(255, 0, 0)');
  });

  it.fails('substitutes arbitrary functions in the selected value', () => {
    const value = resolve('if(else: if(else: red))', { env: styleletEnv })!;
    expect(value.serialize()).toBe('rgb(255, 0, 0)');
  });

  it.fails('returns an empty sequence when no branch matches', () => {
    expect(resolve('if(future(): red)', { env: styleletEnv })?.inner).toBe(guaranteedInvalidValue);
  });
});
