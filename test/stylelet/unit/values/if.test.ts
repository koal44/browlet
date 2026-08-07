import { describe, expect, it, vi } from 'vitest';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { serializeComponentValues } from '../../../../src/stylelet/syntax/component-value';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import type { PropertyContext } from '../../../../src/stylelet/value-processing/context';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import {
  consumeIf, parseIf, parseIfArguments,
} from '../../../../src/stylelet/values/substitution/if';
import {
  defineCustomProperty, guaranteedInvalidValue,
} from '../../../../src/stylelet/values/whole-value';
import { parseSyntax } from '../../../../src/stylelet/values/syntax-value';

describe('<if()>', () => {
  it('parses a nonempty semicolon-separated branch list', () => {
    const value = parseIf('if(future(): red; else: blue;)');

    expect(value).toMatchObject({
      type: 'if',
      branches: [
        {
          condition: { type: 'general-enclosed' },
          value: { type: 'declaration-value' },
        },
        {
          condition: { type: 'else' },
          value: { type: 'declaration-value' },
        },
      ],
    });
    expect(value?.branches.map(({ value: branchValue }) =>
      serializeComponentValues(branchValue.components).trim()
    )).toEqual(['red', 'blue']);
  });

  it('parses Boolean expressions around supports tests', () => {
    expect(parseIf('if(not supports(display: grid): red; else: blue)'))
      .toMatchObject({
        branches: [
          {
            condition: {
              type: 'boolean-not',
              value: {
                type: 'boolean-test',
                value: {
                  type: 'supports',
                  condition: { type: 'supports-declaration' },
                },
              },
            },
          },
          { condition: { type: 'else' } },
        ],
      });
  });

  it('parses a supports condition as a supports test', () => {
    expect(parseIf(
      'if(supports((display: grid) and (color: red)): yes; else: no)',
    )?.branches[0]).toMatchObject({
      condition: {
        type: 'boolean-test',
        value: {
          type: 'supports',
          condition: { type: 'boolean-and' },
        },
      },
    });
  });

  it('retains unsupported media and style tests as general-enclosed', () => {
    expect(
      parseIf('if(media(width > 10px): wide; else: narrow)')?.branches[0],
    ).toMatchObject({
      condition: { type: 'general-enclosed' },
    });
    expect(
      parseIf('if(style(--scheme: dark): dark; else: light)')?.branches[0],
    ).toMatchObject({
      condition: { type: 'general-enclosed' },
    });
  });

  it.each([
    ['if(else:)', false],
    ['if(else:;)', false],
    ['if(else:{})', false],
    ['if(else: red)', true],
  ])('parses an optional branch value in %j', (input, hasComponents) => {
    const value = parseIf(input);

    expect(value).not.toBeNull();
    expect(value!.branches[0].value.components.length > 0).toBe(hasComponents);
  });

  it('uses braces to bound a value containing a top-level comma', () => {
    const value = parseIf('if(else: {Times, serif})');

    expect(serializeComponentValues(value!.branches[0].value.components))
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
    expect(parseIf(input)).toBeNull();
  });

  it('consumes one notation without consuming following input', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('if(else: red) trailing'),
    );

    expect(consumeIf(c)?.type).toBe('if');
    expect(c.pos()).toBe(1);
  });
});

describe('<if-args>', () => {
  it('divides branches without parsing their conditions', () => {
    const value = parseIfArguments(
      'if(var(--condition): var(--when-true); else: var(--fallback))',
    );

    expect(value?.branches.map(({ condition, value: branchValue }) => [
      serializeComponentValues(condition.components).trim(),
      serializeComponentValues(branchValue.components).trim(),
    ])).toEqual([
      ['var(--condition)', 'var(--when-true)'],
      ['else', 'var(--fallback)'],
    ]);
  });

  it('requires the literal colon and semicolon branch boundaries', () => {
    expect(parseIfArguments('if(var(--branch); else: green;)')).toBeNull();
  });
});

describe('if() replacement', () => {
  const property = defineCustomProperty({ syntax: parseSyntax('<color>')! });

  function resolve(input: string, context: PropertyContext = {}) {
    return property.parse(input)?.resolve(ValueStage.Computed, context);
  }

  it.fails('selects the first branch whose supports test is true', () => {
    const supports = vi.fn(({ name }) => name === 'color');
    const value = resolve(
      'if(supports(color: red): red; supports(width: 10px): blue; else: black)',
      { supports },
    );

    expect(value?.serialize()).toBe('rgb(255, 0, 0)');
    expect(supports).toHaveBeenCalledTimes(1);
  });

  it.fails('falls through a false supports test to else', () => {
    const supports = vi.fn(() => false);
    const value = resolve(
      'if(supports(color: red): blue; else: red)',
      { supports },
    );

    expect(value?.serialize()).toBe('rgb(255, 0, 0)');
    expect(supports).toHaveBeenCalledTimes(1);
  });

  it.fails('treats general-enclosed syntax inside supports as false', () => {
    const supports = vi.fn(() => true);
    const value = resolve(
      'if(not supports(future(feature)): red; else: blue)',
      { supports },
    );

    expect(value?.serialize()).toBe('rgb(255, 0, 0)');
    expect(supports).not.toHaveBeenCalled();
  });

  it.fails('skips a condition that does not parse after substitution', () => {
    expect(resolve('if(not-a-condition: blue; else: red)')?.serialize())
      .toBe('rgb(255, 0, 0)');
  });

  it.fails('does not substitute the value of a false branch', () => {
    expect(resolve('if(future(): var(--missing); else: red)')?.serialize())
      .toBe('rgb(255, 0, 0)');
  });

  it.fails('substitutes arbitrary functions in the selected value', () => {
    expect(resolve('if(else: if(else: red))')?.serialize())
      .toBe('rgb(255, 0, 0)');
  });

  it.fails('returns an empty sequence when no branch matches', () => {
    expect(resolve('if(future(): red)')).toBe(guaranteedInvalidValue);
  });
});
