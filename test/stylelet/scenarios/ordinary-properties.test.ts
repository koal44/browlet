import { expect, test, type Page } from '@playwright/test';
import { require as tsRequire } from 'tsx/cjs/api';

import type * as BrowletModule from '../../../src/browlet/browlet';
import { runScenarios } from '../../scenario/dispatch';
import { BROWSER_NAMES } from '../../scenario/harness';
import { exerciseOrdinaryProperties, ordinaryPropertyExpectations } from '../ordinary-properties.contracts';

const { Browlet } = tsRequire('../../../src/browlet/browlet.ts', __filename) as typeof BrowletModule;
const kinds = Object.keys(ordinaryPropertyExpectations) as (keyof typeof ordinaryPropertyExpectations)[];

runScenarios('ordinary property substitution and defaulting', 'normal', BROWSER_NAMES.flatMap((browser) => kinds.map((kind) => ({
  name: `${browser}: ${kind}`,
  browsers: [browser],
  engines: ['native' as const],
  markup: '',
  setupPage: async (page: Page) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(exerciseOrdinaryProperties, kind)).toEqual(ordinaryPropertyExpectations[kind]);
    // SPEC_CLASH(pending-shorthand-occurrence): Keep each occurrence's expansion separate.
    // Firefox reuses the inline margin for sides that instead cascade from the sheet (3px 4px).
    test.fail(browser === 'firefox' && kind === 'pending-distinct-occurrences',
      'Firefox reuses a different pending margin occurrence');
    // SPEC_CLASH(deferred-value-source-serialization): Preserve the original spelling.
    // WebKit decodes the function name and drops interior comments.
    test.fail(browser === 'webkit' && kind === 'deferred-escapes-comments',
      'Approved WebKit deferred-value source serialization difference');
    // SPEC_CLASH(deferred-value-eof-serialization): Follow Chromium's source preservation.
    // Firefox completes all delimiters; WebKit completes strings/URLs, but not blocks.
    test.fail(
      kind === 'deferred-eof-block' && browser === 'firefox' ||
      (kind === 'deferred-eof-string' || kind === 'deferred-eof-url') && browser !== 'chromium',
      'Approved native deferred-value EOF serialization difference',
    );
    expect(await page.evaluate(exerciseOrdinaryProperties, kind)).toEqual(ordinaryPropertyExpectations[kind]);
  },
}))));
