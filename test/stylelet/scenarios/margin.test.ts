import { expect, test, type Page } from '@playwright/test';
import { require as tsRequire } from 'tsx/cjs/api';

import type * as BrowletModule from '../../../src/browlet/browlet';
import { runScenarios } from '../../scenario/dispatch';
import { BROWSER_NAMES } from '../../scenario/harness';
import { exerciseMargin, marginExpectations } from '../margin.contracts';

const { Browlet } = tsRequire('../../../src/browlet/browlet.ts', __filename) as typeof BrowletModule;
const kinds = Object.keys(marginExpectations) as (keyof typeof marginExpectations)[];

runScenarios('CSSOM margin shorthand', 'normal', BROWSER_NAMES.flatMap((browser) => kinds.map((kind) => ({
  name: `${browser}: ${kind}`,
  browsers: [browser],
  engines: ['native' as const],
  markup: '',
  setupPage: async (page: Page) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(exerciseMargin, kind)).toEqual(marginExpectations[kind]);
    const native = await page.evaluate(exerciseMargin, kind);
    if (kind === 'unchanged-assignment') {
      // CSSOM's set-a-declaration constraints permit returning true even without
      // changing the declarations, so a redundant attribute rewrite also conforms.
      expect(['margin: 1px 1px; color: red', 'margin: 1px; color: red;']).toContain(native);
      return;
    }
    // SPEC_CLASH(shorthand-removal-return): Chromium/WebKit return empty text;
    // CSSOM and Firefox return the former shorthand value. Browlet is asserted above.
    test.fail(browser !== 'firefox' && kind === 'removal-return', 'Approved native shorthand-removal return disagreement');
    expect(native).toEqual(marginExpectations[kind]);
  },
}))));
