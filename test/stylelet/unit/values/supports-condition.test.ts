import { describe, expect, it } from 'vitest';
import {
  SupportsConditionValue,
} from '../../../../src/stylelet/values/supports-condition';
import { serializeComponentValues } from '../../../../src/stylelet/syntax/component-value';

describe('<supports-condition>', () => {
  it('parses a declaration feature', () => {
    const condition = SupportsConditionValue.parse('(display: grid)', {})!;
    expect(condition.evaluate({
      supports: (declaration) => {
        expect(declaration.name).toBe('display');
        expect(declaration.important).toBe(false);
        expect(serializeComponentValues(declaration.value.tokens)).toBe('grid');
        return true;
      },
    })).toBe(true);
  });

  it('allows an empty declaration value', () => {
    const condition = SupportsConditionValue.parse('(display:)', {})!;
    expect(condition.evaluate({
      supports: (declaration) => {
        expect(declaration.value.tokens).toEqual([]);
        return true;
      },
    })).toBe(true);
  });

  it('parses a declaration important flag', () => {
    const condition = SupportsConditionValue.parse('(display: grid !important)', {})!;
    expect(condition.evaluate({ supports: (declaration) => declaration.important })).toBe(true);
  });

  it('parses negation, conjunction, and disjunction', () => {
    const context = { supports: () => true };
    expect(SupportsConditionValue.parse('not (display: grid)', {})?.evaluate(context)).toBe(false);
    expect(SupportsConditionValue.parse('(display: grid) and (color: red)', {})?.evaluate(context)).toBe(true);
    expect(SupportsConditionValue.parse('(display: grid) or (display: flex)', {})?.evaluate(context)).toBe(true);
  });

  it('treats future syntax as unsupported without querying declaration support', () => {
    for (const input of ['future(feature)', '(display: grid;)']) {
      const condition = SupportsConditionValue.parse(input, {})!;
      expect(condition.evaluate({
        supports: () => { throw new Error('Unexpected declaration query'); },
      })).toBe(false);
    }
  });

  it.each([
    '',
    'not',
    'display: grid',
    '(display: grid) and',
    '(display: grid) and (color: red) or (width: 1px)',
  ])('rejects %j', (input) => {
    expect(SupportsConditionValue.parse(input, {})).toBeNull();
  });
});

describe('supports evaluation', () => {
  it('uses the current declaration-support callback without retaining it', () => {
    const condition = SupportsConditionValue.parse('(display: grid)', {})!;
    expect(condition.evaluate({ supports: (declaration) => declaration.name === 'display' })).toBe(true);
    expect(condition.evaluate({ supports: () => false })).toBe(false);
  });

  it('does not query later declarations once conjunction is false', () => {
    const condition = SupportsConditionValue.parse('(display: grid) and (color: red)', {})!;
    const queried: string[] = [];
    expect(condition.evaluate({
      supports: (declaration) => {
        queried.push(declaration.name);
        return false;
      },
    })).toBe(false);
    expect(queried).toEqual(['display']);
  });

  it('treats unknown syntax as false before applying negation', () => {
    const condition = SupportsConditionValue.parse('not future(feature)', {})!;
    expect(condition.evaluate({ supports: () => { throw new Error('Unexpected declaration query'); } })).toBe(true);
  });

  it('requires the dependency that decides declaration support', () => {
    const condition = SupportsConditionValue.parse('(display: grid)', {})!;
    expect(() => condition.evaluate({})).toThrow('Supports evaluation requires a declaration-support query');
  });
});
