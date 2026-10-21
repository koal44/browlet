import { expect, test, type Page } from '@playwright/test';
import { require as tsRequire } from 'tsx/cjs/api';

import type * as BrowletModule from '../../../src/browlet/browlet';
import { runScenarios } from '../../scenario/dispatch';
import { BROWSER_NAMES, type BrowserName } from '../../scenario/harness';
import { exerciseRules, ruleExpectations } from '../rules.contracts';

// Keep the production TypeScript transform independent of Playwright's Babel loader.
const { Browlet } = tsRequire('../../../src/browlet/browlet.ts', __filename) as typeof BrowletModule;

const comparisons: { kind: keyof typeof ruleExpectations; differing: BrowserName[]; }[] = [
  { kind: 'style', differing: [] },
  { kind: 'mutation', differing: [] },
  { kind: 'namespace', differing: [] },
  { kind: 'declaration-order', differing: [] },
  // SPEC_CLASH(important-declaration-order): Chromium/WebKit move the important winner after opacity.
  { kind: 'important-order', differing: ['chromium', 'webkit'] },
  // SPEC_CLASH(detached-group-rule-insertion): Firefox throws NS_ERROR_FAILURE.
  { kind: 'detached', differing: ['firefox'] },
  // SPEC_CLASH(namespace-insertion-error-order): Chromium/WebKit return InvalidStateError.
  { kind: 'namespace-error-order', differing: ['chromium', 'webkit'] },
];

runScenarios('CSSOM rule operations', 'normal', BROWSER_NAMES.flatMap((browser) => comparisons.map(({ kind, differing }) => ({
  name: `${browser}: ${kind}`,
  browsers: [browser],
  engines: ['native' as const],
  markup: '',
  setupPage: async (page: Page) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(exerciseRules, kind)).toEqual(ruleExpectations[kind]);
    const native = await page.evaluate(exerciseRules, kind);
    // Project assertions and browser setup finish before a native-only expected failure.
    test.fail(differing.includes(browser), 'Approved native CSSOM rule disagreement');
    expect(native).toEqual(ruleExpectations[kind]);
  },
}))));
