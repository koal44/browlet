import { expect, test, type Page } from '@playwright/test';
import { require as tsRequire } from 'tsx/cjs/api';

import type * as MediaListModule from '../../../src/stylelet/cssom/media/media-list';
import type * as EnvironmentFixture from '../environment-fixture';
import { runScenarios } from '../../scenario/dispatch';
import { BROWSER_NAMES } from '../../scenario/harness';

const { MediaListImpl } = tsRequire('../../../src/stylelet/cssom/media/media-list.ts', __filename) as typeof MediaListModule;
const { styleletEnv } = tsRequire('../environment-fixture.ts', __filename) as typeof EnvironmentFixture;

const mediaQueries: [string, string][] = [
  ['', ''],
  ['  ', ''],
  ['SCREEN, print, SCREEN', 'screen, print, screen'],
  ['ONLY Screen AND (color)', 'only screen and (color)'],
  ['only all and (color)', 'only all and (color)'],
  ['(ORIENTATION: LANDSCAPE)', '(orientation: landscape)'],
  ['(orientation: PORTRAIT)', '(orientation: portrait)'],
  ['(SCAN: INTERLACE)', '(scan: interlace)'],
  ['(scan: PROGRESSIVE)', '(scan: progressive)'],
  ['(unknown-feature: FOO)', '(unknown-feature: FOO)'],
  ['(orientation: UNKNOWN)', '(orientation: UNKNOWN)'],
  ['(width: banana)', '(width: banana)'],
  ['(400px < width <= 1200px)', '(400px < width <= 1200px)'],
  ['(color) or (monochrome)', '(color) or (monochrome)'],
  ['screen, &, print', 'screen, not all, print'],
  [',', 'not all, not all'],
  ['screen,', 'screen, not all'],
  ['screen,/**/', 'screen, not all'],
  ['screen, ', 'screen, not all'],
];

const generalEnclosedQueries: [string, string][] = [
  ['future(a,', 'future(a,)'],
  ['FUTURE(a  b)', 'FUTURE(a b)'],
  ['future(a/**/b)', 'future(a/**/b)'],
  ['(future a  b)', '(future a b)'],
];

// Exercises Stylelet as well as native CSSOM, including the approved
// media-query-only-serialization and media-query-trailing-comma clashes.
runScenarios('MediaList parsing and mutation', 'normal', [
  {
    name: 'Stylelet and native MediaList serialize the same query lists',
    engines: ['native'],
    markup: '',
    setupPage: async (page) => {
      for (const [input, expected] of mediaQueries) {
        expect(new MediaListImpl(input, styleletEnv).mediaText, input).toBe(expected);
      }
      const native = await page.evaluate((inputs) => {
        const sheet = new CSSStyleSheet();
        return inputs.map((input) => {
          sheet.media.mediaText = input;
          return sheet.media.mediaText;
        });
      }, mediaQueries.map(([input]) => input));
      expect(native).toEqual(mediaQueries.map(([, expected]) => expected));
    },
  },
  ...BROWSER_NAMES.map((browser) => ({
    name: `${browser}: general-enclosed serialization`,
    browsers: [browser],
    engines: ['native' as const],
    markup: '',
    setupPage: async (page: Page) => {
      for (const [input, expected] of generalEnclosedQueries) {
        expect(new MediaListImpl(input, styleletEnv).mediaText, input).toBe(expected);
      }
      const native = await page.evaluate((inputs) => {
        const sheet = new CSSStyleSheet();
        return inputs.map((input) => {
          sheet.media.mediaText = input;
          return sheet.media.mediaText;
        });
      }, generalEnclosedQueries.map(([input]) => input));
      // SPEC_GAP(media-general-enclosed-serialization): All three browsers retain
      // original whitespace; Chromium/Firefox also retain missing closers.
      test.fail(true, 'Approved native general-enclosed serialization difference');
      expect(native).toEqual(generalEnclosedQueries.map(([, expected]) => expected));
    },
  })),
  ...BROWSER_NAMES.map((browser) => ({
    name: `${browser}: canonical comparison and duplicate deletion`,
    browsers: [browser],
    engines: ['native' as const],
    // SPEC_CLASH(media-list-mutation-comparison): Firefox moves the existing
    // orientation query to the end; Chromium/WebKit leave it in place.
    ...(browser === 'firefox' ? { status: 'fail' as const } : {}),
    markup: '',
    setupPage: async (page: Page) => {
      const list = new MediaListImpl('(orientation: LANDSCAPE), screen, SCREEN', styleletEnv);
      list.appendMedium('(ORIENTATION: landscape)');
      const afterAppend = list.mediaText;
      list.deleteMedium('screen');
      const expected = { afterAppend, result: list.mediaText };
      expect(expected).toEqual({
        afterAppend: '(orientation: landscape), screen, screen',
        result: '(orientation: landscape)',
      });
      const native = await page.evaluate(() => {
        const sheet = new CSSStyleSheet();
        const list = sheet.media;
        list.mediaText = '(orientation: LANDSCAPE), screen, SCREEN';
        list.appendMedium('(ORIENTATION: landscape)');
        const afterAppend = list.mediaText;
        list.deleteMedium('screen');
        return { afterAppend, result: list.mediaText };
      });
      expect(native).toEqual(expected);
    },
  })),
  ...BROWSER_NAMES.flatMap((browser) => ['', ',', 'screen, print', '&'].map((input) => ({
    name: `${browser}: mutation with ${JSON.stringify(input)}`,
    browsers: [browser],
    engines: ['native' as const],
    // SPEC_CLASH(media-list-mutation-input): Firefox rejects empty/invalid input
    // and deletes screen for a multiple-query input. WebKit agrees for invalid
    // single queries but differs on empty/multiple input; see the roadmap.
    ...(browser === 'chromium' || browser === 'webkit' && input === '&' ? {} : { status: 'fail' as const }),
    markup: '',
    setupPage: async (page: Page) => {
      const list = new MediaListImpl('screen', styleletEnv);
      list.appendMedium(input);
      const afterAppend = list.mediaText;
      list.deleteMedium(input);
      const expected = { afterAppend, result: list.mediaText, appendError: null, deleteError: null };
      expect(expected).toEqual({
        afterAppend: input === '&' ? 'screen, not all' : 'screen',
        result: 'screen', appendError: null, deleteError: null,
      });

      const native = await page.evaluate((input) => {
        const sheet = new CSSStyleSheet();
        const list = sheet.media;
        list.mediaText = 'screen';
        let appendError: string | null = null;
        let deleteError: string | null = null;
        try { list.appendMedium(input); }
        catch (error) { appendError = (error as DOMException).name; }
        const afterAppend = list.mediaText;
        try { list.deleteMedium(input); }
        catch (error) { deleteError = (error as DOMException).name; }
        return { afterAppend, result: list.mediaText, appendError, deleteError };
      }, input);
      expect(native).toEqual(expected);
    },
  }))),
]);
