import { expect } from '@playwright/test';
import { serializeCssIdentifier } from '../../../src/stylelet/syntax/component-value';
import { parseSelectorList, serializeSelectorList } from '../../../src/stylelet/selector/parser';
import { runScenarios } from '../../scenario/dispatch';
import { BROWSER_NAMES } from '../../scenario/harness';

const excludedCharacters = [0x80, 0xa0, 0xd7, 0x200e].map((code) => String.fromCodePoint(code));

runScenarios('style syntax identifier serialization', 'normal', [
  {
    name: 'Stylelet escapes remain usable as selectors in all three browsers',
    engines: ['native'],
    markup: '',
    setupPage: async (page) => {
      const selectors = excludedCharacters.map((character) => {
        const selector = `#${serializeCssIdentifier(character)}`;
        expect(selector).toBe(`#\\${character}`);
        const parsed = parseSelectorList(selector);
        expect(parsed).not.toBeNull();
        expect(serializeSelectorList(parsed!)).toBe(selector);
        return selector;
      });

      expect(await page.evaluate(({ characters, selectors }) => characters.map((character, index) => {
        const element = document.createElement('div');
        element.id = character;
        document.body.append(element);
        return document.querySelector(selectors[index]!) === element;
      }), { characters: excludedCharacters, selectors })).toEqual([true, true, true, true]);
    },
  },
]);

// SPEC_CLASH(css-non-ascii-ident-serialization): Browser-only evidence. CSSOM
// and all three engines emit these characters literally; Syntax requires an
// escape for each to remain an identifier. Keep our chosen Syntax expectation.
runScenarios('native non-ASCII identifier serialization oracle', 'skip', BROWSER_NAMES.map((browser) => ({
  name: `${browser} escapes characters excluded by Syntax`,
  browsers: [browser],
  engines: ['native'],
  status: 'fail',
  markup: '',
  setupPage: async (page) => {
    const result = await page.evaluate((characters) => characters.map((character) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`.\\${character} {}`);
      return {
        escaped: CSS.escape(character),
        selector: (sheet.cssRules[0] as CSSStyleRule).selectorText,
      };
    }), excludedCharacters);
    expect(result).toEqual(excludedCharacters.map((character) => ({
      escaped: `\\${character}`, selector: `.\\${character}`,
    })));
  },
})));
