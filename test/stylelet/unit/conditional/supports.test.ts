import { describe, expect, it } from 'vitest';
import {
  parseSupportsCondition,
} from '../../../../src/stylelet/conditional/supports';
import { serializeComponentValues } from '../../../../src/stylelet/syntax/component-value';

describe('<supports-condition>', () => {
  it('parses a declaration feature', () => {
    const value = parseSupportsCondition('(display: grid)');

    expect(value).toMatchObject({
      type: 'boolean-test',
      value: {
        type: 'supports-declaration',
        declaration: {
          name: 'display',
          important: false,
        },
      },
    });
    if (value?.type === 'boolean-test') {
      expect(serializeComponentValues(value.value.declaration.value))
        .toBe('grid');
    }
  });

  it('allows an empty declaration value', () => {
    expect(parseSupportsCondition('(display:)')).toMatchObject({
      type: 'boolean-test',
      value: {
        declaration: { value: [] },
      },
    });
  });

  it('parses a declaration important flag', () => {
    expect(parseSupportsCondition('(display: grid !important)'))
      .toMatchObject({
        type: 'boolean-test',
        value: {
          declaration: {
            important: true,
          },
        },
      });
  });

  it('parses negation, conjunction, and disjunction', () => {
    expect(parseSupportsCondition('not (display: grid)'))
      .toMatchObject({
        type: 'boolean-not',
        value: { type: 'boolean-test' },
      });
    expect(parseSupportsCondition('(display: grid) and (color: red)'))
      .toMatchObject({
        type: 'boolean-and',
        values: [
          { type: 'boolean-test' },
          { type: 'boolean-test' },
        ],
      });
    expect(parseSupportsCondition('(display: grid) or (display: flex)'))
      .toMatchObject({
        type: 'boolean-or',
        values: [
          { type: 'boolean-test' },
          { type: 'boolean-test' },
        ],
      });
  });

  it('retains future syntax as general-enclosed', () => {
    expect(parseSupportsCondition('future(feature)')).toMatchObject({
      type: 'general-enclosed',
    });
    expect(parseSupportsCondition('(display: grid;)')).toMatchObject({
      type: 'general-enclosed',
    });
  });

  it.each([
    '',
    'not',
    'display: grid',
    '(display: grid) and',
    '(display: grid) and (color: red) or (width: 1px)',
  ])('rejects %j', (input) => {
    expect(parseSupportsCondition(input)).toBeNull();
  });
});
