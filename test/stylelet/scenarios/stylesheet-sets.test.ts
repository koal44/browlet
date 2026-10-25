import { createServer } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { require as tsRequire } from 'tsx/cjs/api';

import type * as DocumentFixtureModule from '../browlet-document';
import type * as StyleletModule from '../../../src/stylelet/index';
import { runScenarios } from '../../scenario/dispatch';
import { BROWSER_NAMES } from '../../scenario/harness';

const { createBrowletDocument } = tsRequire('../browlet-document.ts', __filename) as typeof DocumentFixtureModule;
const { Stylelet } = tsRequire('../../../src/stylelet/index.ts', __filename) as typeof StyleletModule;

const titles = ['alpha', 'beta', 'alpha,beta', 'Beta', ''];
const selections = [
  { name: 'no header', headers: [], selected: 'alpha' },
  { name: 'one header', headers: ['beta'], selected: 'beta' },
  { name: 'repeated headers', headers: ['alpha', 'beta'], selected: 'beta' },
  { name: 'comma in the set name', headers: ['alpha,beta'], selected: 'alpha,beta' },
];

// These remain enabled: every scenario exercises Stylelet before comparing native behavior.
runScenarios('stylesheet-set selection', 'normal', BROWSER_NAMES.flatMap((browser) => selections.map((selection) => ({
  name: `${browser}: ${selection.name}`,
  browsers: [browser],
  engines: ['native' as const],
  markup: '',
  setupPage: async (page: Page) => {
    const expected = titles.map((title) => title !== '' && title !== selection.selected);
    const document = createBrowletDocument();
    const scope = new Stylelet(document, { env: document.env }).documentScope;
    for (const name of selection.headers) scope.changePreferredStyleSheetSetName(name);
    for (const title of titles) {
      const owner = document.createElement('style');
      document.head!.appendChild(owner);
      scope.createStyleElementStyleSheet(owner, '', { title });
    }
    const actual = [...scope.styleSheets].map((sheet) => sheet.disabled);
    expect(actual).toEqual(expected);

    const server = createServer((_request, response) => {
      const headers = ['Content-Type', 'text/html'];
      for (const value of selection.headers) headers.push('Default-Style', value);
      response.writeHead(200, headers);
      response.end(`<!doctype html>${titles.map((title) => `<style title="${title}">div { opacity: .5 }</style>`).join('')}`);
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    let native: boolean[];
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('Expected a local HTTP listener');
      await page.goto(`http://127.0.0.1:${address.port}/`);
      native = await page.evaluate(() => [...document.styleSheets].map((sheet) => sheet.disabled));
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error) reject(error); else resolve(); });
      });
    }

    // Stylelet checks, browser setup, and server cleanup must succeed before this annotation.
    // SPEC_CLASH(stylesheet-set-disabled-flags): Chromium/WebKit leave all flags false.
    // SPEC_CLASH(default-style-response-fields): Chromium/WebKit ignore the headers;
    // Firefox combines repeated fields to "alpha, beta", selecting none of these sets.
    test.fail(browser !== 'firefox' || selection.headers.length > 1, 'Known native stylesheet-set disagreement');
    expect(native).toEqual(expected);
  },
}))));
