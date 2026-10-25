import { expect } from '@playwright/test';
import { require as tsRequire } from 'tsx/cjs/api';

import type * as BrowletModule from '../../../src/browlet/browlet';
import { runScenarios } from '../../scenario/dispatch';

const { Browlet } = tsRequire('../../../src/browlet/browlet.ts', __filename) as typeof BrowletModule;

// Exercise Stylelet through Browlet's bindings in Node and native CSSOM in Playwright.
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
      const browlet = new Browlet({ route: () => '' });
      expect(await browlet.evaluate(inspectSheet)).toEqual(expected);
      expect(await page.evaluate(inspectSheet)).toEqual(expected);
    },
  },
]);

function inspectSheet() {
  const sheet = new CSSStyleSheet({ media: 'screen', disabled: true });
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
