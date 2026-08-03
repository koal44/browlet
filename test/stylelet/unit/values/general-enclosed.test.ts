import { describe, expect, it } from 'vitest';
import { ComponentCursor } from '../../../../src/stylelet/parser/component-cursor';
import { BlockKind } from '../../../../src/stylelet/parser/component-value';
import { parseListOfComponentValues } from '../../../../src/stylelet/parser/syntax';
import {
  parseGeneralEnclosed,
  tryConsumeGeneralEnclosed,
} from '../../../../src/stylelet/values/general-enclosed';

describe('<general-enclosed>', () => {
  it.each([
    ['future()', BlockKind.Function],
    ['future(value)', BlockKind.Function],
    ['future(value, {other})', BlockKind.Function],
    ['()', BlockKind.Parens],
    ['(value)', BlockKind.Parens],
    ['(value, {other})', BlockKind.Parens],
  ])('parses %s', (input, block) => {
    expect(parseGeneralEnclosed(input)).toMatchObject({
      type: 'general-enclosed',
      value: { block },
    });
  });

  it('distinguishes an omitted any-value from a present any-value', () => {
    expect(parseGeneralEnclosed('future()')?.value.value).toBeUndefined();
    expect(parseGeneralEnclosed('future(value)')?.value.value).toMatchObject({
      type: 'any-value',
    });
  });

  it.each([
    '',
    'future',
    '{value}',
    'future(])',
    '([)',
    'future() other',
  ])('rejects %j', (input) => {
    expect(parseGeneralEnclosed(input)).toBeNull();
  });

  it('consumes one block and leaves the following components', () => {
    const c = new ComponentCursor(parseListOfComponentValues('future() other'));

    expect(tryConsumeGeneralEnclosed(c)).toMatchObject({
      type: 'general-enclosed',
      value: {
        block: BlockKind.Function,
        name: 'future',
      },
    });
    expect(c.pos()).toBe(1);
  });
});
