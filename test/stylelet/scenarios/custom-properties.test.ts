import { expect, test, type Page } from '@playwright/test';
import { require as tsRequire } from 'tsx/cjs/api';

import type * as BrowletModule from '../../../src/browlet/browlet';
import { runScenarios } from '../../scenario/dispatch';
import { BROWSER_NAMES } from '../../scenario/harness';
import { exerciseCustomProperties, customPropertyExpectations } from '../custom-properties.contracts';

const { Browlet } = tsRequire('../../../src/browlet/browlet.ts', __filename) as typeof BrowletModule;
const kinds = Object.keys(customPropertyExpectations) as (keyof typeof customPropertyExpectations)[];

runScenarios('custom-property computation', 'normal', BROWSER_NAMES.flatMap((browser) => kinds.map((kind) => ({
  name: `${browser}: ${kind}`,
  browsers: [browser],
  engines: ['native' as const],
  markup: '',
  setupPage: async (page: Page) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(exerciseCustomProperties, kind)).toEqual(customPropertyExpectations[kind]);
    const native = await page.evaluate(exerciseCustomProperties, kind);
    // SPEC_CLASH(guaranteed-invalid-enumeration): All three browsers list an explicitly
    // initial custom property; CSSOM excludes it. Each native case fails independently.
    test.fail(kind === 'invalid-enumeration', 'Approved native guaranteed-invalid enumeration disagreement');
    // SPEC_CLASH(empty-custom-property-serialization): The approved single-space
    // result keeps copying a computed empty value from removing the destination.
    test.fail(kind === 'empty-computed-copy', 'Approved native empty custom-value serialization difference');
    // SPEC_CLASH(custom-property-uuid-serialization): Preserve the UUID's original tokens/text.
    // WebKit inserts comment separators within the unchanged UUID after substitution.
    test.fail(kind === 'serialization-stages' && browser === 'webkit',
      'Approved WebKit custom-value UUID serialization difference');
    // SPEC_CLASH(lazy-var-fallback): Chromium/WebKit follow the draft; Firefox
    // invalidates --b because its unused fallback references itself.
    test.fail(kind === 'var-lazy-fallback' && browser === 'firefox', 'Approved native eager fallback cycle detection');
    // SPEC_CLASH(var-argument-grammar): All three browsers reject dynamic names/spread,
    // preserve fallback braces, and validate literal names before computation.
    test.fail(
      kind === 'var-dynamic-name' || kind === 'var-spread' || kind === 'var-fallback-braces' || kind === 'var-name-validation',
      'Approved native older var() argument grammar',
    );
    // SPEC_CLASH(custom-property-eof-serialization): Preserve source spelling as in Chromium.
    // Firefox completes all delimiters; WebKit completes string/URL delimiters, but not blocks.
    test.fail(
      kind === 'substitution-eof-block' && browser === 'firefox' ||
      (kind === 'substitution-eof-string' || kind === 'substitution-eof-url') && browser !== 'chromium',
      'Approved native custom-value EOF serialization difference',
    );
    expect(native).toEqual(customPropertyExpectations[kind]);
  },
}))));
