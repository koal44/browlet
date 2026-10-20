import { expect } from '@playwright/test';
import { runScenarios } from '../../scenario/dispatch';

// Exercise Stylelet's implementation as well as native CSSOM. Browlet's binding
// tests cover conversion/projection; these retain the approved browser choices.
runScenarios('constructed stylesheet contracts', 'normal', [
  {
    name: 'Stylelet and native sheets agree on metadata, media, and insertion failures',
    engines: ['native'],
    markup: '',
    setupPage: async (page) => {
      const expected = {
        href: null, title: null, disabled: true,
        parent: null, owner: null, ownerRule: null,
        media: 'print', retained: true,
        failures: ['IndexSizeError', 'IndexSizeError', 'SyntaxError'],
      };
      expect(await page.evaluate(inspectSheet, 'stylelet' as const)).toEqual(expected);
      expect(await page.evaluate(inspectSheet, 'native' as const)).toEqual(expected);
    },
  },
]);

/** Compare Stylelet's browser bundle with the browser's native sheet implementation. */
function inspectSheet(engine: 'stylelet' | 'native') {
  const options = { media: 'screen', disabled: true };
  const sheet = engine === 'native' ? new CSSStyleSheet(options) : window.stylelet!.createStyleSheet(options);
  const media = sheet.media;
  media.mediaText = 'print';
  const failures: string[] = [];
  for (const [rule, index] of [['invalid', 1], ['@import "sheet.css";', 1], ['invalid', 0]] as const) {
    try { sheet.insertRule(rule, index); failures.push('accepted'); }
    catch (error) { failures.push((error as DOMException).name); }
  }
  return {
    href: sheet.href, title: sheet.title, disabled: sheet.disabled,
    parent: sheet.parentStyleSheet, owner: sheet.ownerNode, ownerRule: sheet.ownerRule,
    media: media.mediaText, retained: sheet.media === media,
    failures,
  };
}
