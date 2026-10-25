import { createServer } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { require as tsRequire } from 'tsx/cjs/api';

import type * as BrowletModule from '../../../src/browlet/browlet';
import type * as ResponseModule from '../../../src/fetch/response';
import type * as BindingFixtureModule from '../../support/browlet-binding';
import { closeServer, listen } from '../../browlet/loader/http-fixture';
import { runScenarios } from '../../scenario/dispatch';
import { BROWSER_NAMES, type BrowserName } from '../../scenario/harness';

// Playwright 1.64.1 emits abstract fields as runtime assignments. Use the same
// scoped TypeScript loader as declaration generation to preserve the class contracts.
const { Browlet } = tsRequire('../../../src/browlet/browlet.ts', __filename) as typeof BrowletModule;
const { FetchResponse } = tsRequire('../../../src/fetch/response.ts', __filename) as typeof ResponseModule;
const { getRelevantRealm } = tsRequire('../../support/browlet-binding.ts', __filename) as typeof BindingFixtureModule;

const comparisons: ({
  name: string; data: string | null; after?: boolean;
  requests: number; differing: BrowserName[];
} & ({ sheets: number; rules: number; events?: false; } | { events: true; }))[] = [
  { name: 'prolog instruction', data: 'href="/sheet.css"', requests: 1, sheets: 1, rules: 1, differing: [] },
  // SPEC_CLASH(xml-stylesheet-prolog): Chromium/WebKit load the post-root instruction.
  { name: 'post-root instruction', data: 'href="/sheet.css"', after: true, requests: 0, sheets: 0, rules: 0, differing: ['chromium', 'webkit'] },
  // SPEC_CLASH(xml-stylesheet-fragment): Chromium/WebKit do not request the fragment URL.
  // SPEC_CLASH(xml-stylesheet-rejected-association): Firefox retains an empty sheet after MIME rejection.
  { name: 'fragment URL with non-CSS response', data: 'href="#css"', requests: 1, sheets: 0, rules: 0, differing: [...BROWSER_NAMES] },
  // CSSOM permits rejecting an unsupported advisory type; Browlet/Firefox recognize this CSS MIME essence.
  { name: 'CSS type with parameters', data: 'href="/sheet.css" type="TEXT/CSS; charset=utf-8"', requests: 1, sheets: 1, rules: 1, differing: ['chromium', 'webkit'] },
  { name: 'unsupported styling language', data: 'href="/sheet.css" type="text/x-unknown-sheet"', requests: 0, sheets: 0, rules: 0, differing: [] },
  // SPEC_CLASH(stylesheet-http-status): reject the error body like all three browsers.
  // SPEC_CLASH(xml-stylesheet-rejected-association): the browsers nevertheless retain empty sheets.
  { name: 'HTTP failure', data: 'href="/missing.css"', requests: 1, sheets: 0, rules: 0, differing: [...BROWSER_NAMES] },
  { name: 'MIME failure', data: 'href="/wrong.css"', requests: 1, sheets: 0, rules: 0, differing: [...BROWSER_NAMES] },
  // SPEC_CLASH(http-link-stylesheets): only Firefox processes the header.
  { name: 'HTTP Link header', data: null, requests: 1, sheets: 1, rules: 1, differing: ['chromium', 'webkit'] },
  // SPEC_GAP(xml-stylesheet-events): Chromium/WebKit dispatch neither event; Firefox dispatches load/error.
  { name: 'successful instruction events', data: 'href="/sheet.css"', requests: 1, events: true, differing: ['firefox'] },
  { name: 'HTTP failure events', data: 'href="/missing.css"', requests: 1, events: true, differing: ['firefox'] },
  { name: 'MIME failure events', data: 'href="/wrong.css"', requests: 1, events: true, differing: ['firefox'] },
];

// Every scenario tests Browlet/Stylelet before annotating a native-browser disagreement.
runScenarios('external stylesheet association', 'normal', BROWSER_NAMES.flatMap((browser) => comparisons.map((comparison) => ({
  name: `${browser}: ${comparison.name}`,
  browsers: [browser],
  engines: ['native' as const],
  markup: '',
  setupPage: async (page: Page) => {
    const requests: string[] = [];
    const markup = '<!doctype html><p>stylesheet target</p>';
    const server = createServer((request, response) => {
      if (request.url !== '/favicon.ico') requests.push(request.url!);
      if (request.url === '/sheet.css') { response.writeHead(200, { 'Content-Type': 'text/css' }).end('p { opacity: .5 }'); }
      else if (request.url === '/missing.css') { response.writeHead(404, { 'Content-Type': 'text/css' }).end('p { opacity: .5 }'); }
      else if (request.url === '/wrong.css') { response.writeHead(200, { 'Content-Type': 'text/plain' }).end('p { opacity: .5 }'); }
      else { response.writeHead(200, {
        'Content-Type': 'text/html',
        ...(request.url === '/header' ? { Link: '</sheet.css>; rel=stylesheet' } : {}),
      }).end(markup); }
    });
    const origin = await listen(server);
    const browlet = new Browlet({ route: () => markup });
    const expected = comparison.events
      ? { requests: comparison.requests, events: [] }
      : { requests: comparison.requests, sheets: comparison.sheets, rules: comparison.rules };
    let native: { requests: number; } & ReturnType<typeof readResult>;
    try {
      await browlet.navigate(`${origin}/page`);
      const env = getRelevantRealm(browlet.window).env;
      const document = env.realm.getAssociatedDocument();
      if (comparison.data === null) {
        const response = new FetchResponse();
        response.headerList.append('Link', '</sheet.css>; rel=stylesheet');
        document.processStyleSheetLinkHeaders(response);
      } else {
        await browlet.evaluate(insertInstruction, { data: comparison.data, after: comparison.after ?? false });
      }
      await expect.poll(() => env.fetchGroup.fetchRecords.every((record) => record.request.done)).toBe(true);
      await new Promise<void>((resolve) => env.exec.queueTask('network', resolve));
      expect({ requests: requests.length, ...await browlet.evaluate(readResult, comparison.events ?? false) }).toEqual(expected);

      requests.length = 0;
      await page.goto(`${origin}/${comparison.data === null ? 'header' : 'page'}`);
      if (comparison.data !== null) {
        requests.length = 0;
        await page.evaluate(insertInstruction, { data: comparison.data, after: comparison.after ?? false });
      }
      await page.waitForLoadState('networkidle');
      native = {
        requests: requests.filter((request) => request !== '/header').length,
        ...await page.evaluate(readResult, comparison.events ?? false),
      };
    } finally {
      await getRelevantRealm(browlet.window).env.userAgent.httpTransport.close();
      await closeServer(server);
    }
    // Setup, project assertions, and cleanup must succeed before this annotation.
    test.fail(comparison.differing.includes(browser), 'Known native stylesheet-association difference');
    expect(native).toEqual(expected);
  },
}))));

/** Exercise the projected DOM mutation in both Browlet and the native browser. */
function insertInstruction({ data, after }: { data: string; after: boolean; }): void {
  const pi = Object.assign(document.createProcessingInstruction('xml-stylesheet', data), { observedEvents: [] as string[] });
  for (const name of ['load', 'error']) pi.addEventListener(name, () => pi.observedEvents.push(name));
  if (after) document.appendChild(pi);
  else document.insertBefore(pi, document.documentElement);
}

/** Observe events separately so an event disagreement cannot mask an association change. */
function readResult(events: boolean): { events: string[]; } | { sheets: number; rules: number; } {
  if (events) {
    const pi = [...document.childNodes].find((node) => node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) as ProcessingInstruction & { observedEvents: string[]; };
    return { events: pi.observedEvents };
  }
  return {
    sheets: document.styleSheets.length,
    rules: [...document.styleSheets].reduce((count, sheet) => count + sheet.cssRules.length, 0),
  };
}
