import { expect, test, type Page } from '@playwright/test';
import { require as tsRequire } from 'tsx/cjs/api';

import type * as BrowletModule from '../../../src/browlet/browlet';
import { runScenarios } from '../../scenario/dispatch';
import { BROWSER_NAMES } from '../../scenario/harness';
import { declarationExpectations, exerciseDeclarations } from '../declarations.contracts';

const { Browlet } = tsRequire('../../../src/browlet/browlet.ts', __filename) as typeof BrowletModule;
const kinds = Object.keys(declarationExpectations) as (keyof typeof declarationExpectations)[];

runScenarios('CSSOM declaration operations', 'normal', BROWSER_NAMES.flatMap((browser) => kinds.map((kind) => ({
  name: `${browser}: ${kind}`,
  browsers: [browser],
  engines: ['native' as const],
  markup: '',
  setupPage: async (page: Page) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(exerciseDeclarations, kind)).toEqual(declarationExpectations[kind]);
    const native = await page.evaluate(exerciseDeclarations, kind);
    // SPEC_CLASH(custom-property-name-serialization): WebKit does not escape names.
    test.fail(browser === 'webkit' && kind === 'name-serialization', 'Approved native name-escaping disagreement');
    // SPEC_CLASH(empty-value-priority-order): Chromium/WebKit check priority before removal.
    test.fail(browser !== 'firefox' && kind === 'empty-priority', 'Approved native empty-value priority ordering');
    // SPEC_CLASH(css-declaration-indexed-write): Chromium reports success without an indexed setter.
    test.fail(browser === 'chromium' && kind === 'indexed-write', 'Approved native indexed-write disagreement');
    // SPEC_CLASH(css-property-attribute-placement): Chromium exposes own property attributes.
    test.fail(browser === 'chromium' && kind === 'property-attributes', 'Approved native property placement disagreement');
    expect(native).toEqual(declarationExpectations[kind]);
  },
}))));
