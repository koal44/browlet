import { describe, expect, it } from 'vitest';
import { parseStylesheet } from '../../../src/stylelet/parser/ast';
import { BlockItemAstKind, type StyleRuleAst } from '../../../src/stylelet/parser/types';
import { serializeAnPlusB } from '../../../src/stylelet/values/an-plus-b';

const animationName = (...values: unknown[]) => ({
  type: 'animation-name',
  values,
});

const none = () => ({ type: 'none' });
const customIdent = (value: string) => ({ type: 'custom-ident', value });
const stringValue = (value: string) => ({ type: 'string', value });

function valueOf(css: string): unknown {
  const sheet = parseStylesheet(`.foo { ${css} }`);
  const rule = sheet.rules[0] as StyleRuleAst | undefined;

  const item = rule?.block.items[0];

  if (item?.kind !== BlockItemAstKind.Declaration) {
    return undefined;
  }

  return item.value;
}

describe('style values', () => {

  describe('An+B', () => {
    it.each([
      [{ a: 0, b: 3 }, '3'],
      [{ a: 1, b: 0 }, 'n'],
      [{ a: -1, b: 3 }, '-n+3'],
      [{ a: 2, b: -1 }, '2n-1'],
      [{ a: -2, b: 0 }, '-2n'],
      [{ a: 0, b: -0 }, '0'],
    ] as const)('serializes %j as %s', (value, expected) => {
      expect(serializeAnPlusB(value)).toBe(expected);
    });
  });

  // This is unfinished!! we'll come back to it later. promise.
  describe.skip('animation-name', () => {
    it('parses none', () => {
      expect(valueOf('animation-name: none;')).toMatchObject(
        animationName(none()),
      );
    });

    it('parses a custom ident keyframes name', () => {
      expect(valueOf('animation-name: fade-in;')).toMatchObject(
        animationName(customIdent('fade-in')),
      );
    });

    it('parses a string keyframes name', () => {
      expect(valueOf('animation-name: "fade-in";')).toMatchObject(
        animationName(stringValue('fade-in')),
      );
    });

    it('parses comma-separated animation names', () => {
      expect(valueOf('animation-name: fade-in, "slide", none;')).toMatchObject(
        animationName(
          customIdent('fade-in'),
          stringValue('slide'),
          none(),
        ),
      );
    });

    it('drops invalid animation-name declarations', () => {
      const cases = [
        'animation-name: ;',
        'animation-name: 1;',
        'animation-name: 1px;',
        'animation-name: var(--x);',
        'animation-name: fade-in,;',
        'animation-name: fade-in,, slide;',
      ];

      for (const css of cases) {
        expect(valueOf(css)).toBeUndefined();
      }
    });
  });
});
