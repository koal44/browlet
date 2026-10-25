import { serializeURL } from '../../../src/url/core/index';
import { createServer, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { CSPList } from '../../../src/browlet/browsing/policy/csp/list';
import { FetchResponse } from '../../../src/fetch/response';
import { CSSStyleSheetImpl } from '../../../src/stylelet/cssom/css-stylesheet';
import { CSSStyleRuleImpl } from '../../../src/stylelet/cssom/rules/style';
import type { CSSImportRuleImpl } from '../../../src/stylelet/cssom/rules/import';
import { getRelevantRealm } from '../../support/browlet-binding';
import { closeServer, listen } from '../loader/http-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('CSSOM stylesheet fetching', () => {
  it('captures fetched URL records without reparsing their strings', async () => {
    const browser = await createBrowser('https://example.test');
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const url = document.env.parseURL('https://example.test/start.css')!;
    const finalURL = document.env.parseURL('https://example.test/final/sheet.css')!;
    const response = new FetchResponse();
    response.urlList.push(finalURL);
    const parser = vi.spyOn(document.env.userAgent, 'parseURL');
    try {
      const sheet = document.createFetchedStyleSheet(url, response, new Uint8Array(), {
        ownerNode: null, media: '', title: '', alternate: false,
      });
      expect(parser).not.toHaveBeenCalled();
      expect(sheet.location).toEqual(url);
      expect(sheet.baseURL).toEqual(finalURL);
      url.path = ['changed.css'];
      finalURL.path = ['changed.css'];
      expect(sheet.href).toBe('https://example.test/start.css');
      expect(serializeURL(sheet.baseURL!)).toBe('https://example.test/final/sheet.css');
    } finally {
      parser.mockRestore();
    }
  });

  it.each([
    { type: 'text/css', quirks: false, cross: false, accept: true },
    { type: 'TEXT/CSS; charset=utf-8', quirks: false, cross: false, accept: true },
    { type: 'text/plain', quirks: false, cross: false, accept: false },
    { type: 'text/plain', quirks: true, cross: false, accept: true },
    { type: 'text/plain', quirks: true, cross: true, accept: false },
    { type: 'text/css', quirks: false, cross: true, accept: true },
  ])('checks MIME and origin ($type, quirks=$quirks, cross=$cross)', async ({ type, quirks, cross, accept }) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': type }).end('p { opacity: .5 }');
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = await createBrowser(origin, quirks);
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const url = document.env.parseURL(`${cross ? origin.replace('127.0.0.1', 'localhost') : origin}/sheet.css`)!;
    const result = await new Promise<{ accepted: boolean; clean: boolean; }>((resolve) => {
      document.fetchCSSStyleSheet(url, document.url, {}, (response, bytes, outcome) => {
        expect(outcome).toBe(accept ? 'success' : 'failure');
        if (bytes === null) { resolve({ accepted: false, clean: false }); return; }
        const sheet = document.createFetchedStyleSheet(url, response, bytes, {
          ownerNode: null, media: '', title: '', alternate: false,
        });
        expect(sheet.ruleList.length).toBe(1);
        let clean = true;
        try { void sheet.cssRules; } catch { clean = false; }
        resolve({ accepted: true, clean });
      });
    });
    expect(result).toEqual({ accepted: accept, clean: accept && !cross });
  });

  it.each([
    { transport: 'windows-1252', source: Buffer.from('.caf\xe9 { opacity: .5 }', 'latin1'), charset: 'utf-8' },
    { transport: '', source: Buffer.from('@charset "windows-1252"; .caf\xe9 { opacity: .5 }', 'latin1'), charset: 'utf-8' },
    { transport: '', source: Buffer.from('.caf\xe9 { opacity: .5 }', 'latin1'), charset: 'windows-1252' },
    { transport: 'windows-1252', source: Buffer.from('\uFEFF.café { opacity: .5 }'), charset: 'windows-1252' },
  ])('decodes network bytes with transport=$transport and PI charset=$charset', async ({ transport, source, charset }) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': `text/css${transport ? `; charset=${transport}` : ''}` }).end(source);
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = await createBrowser(origin);
    await browser.evaluate((charset) => {
      const pi = document.createProcessingInstruction('xml-stylesheet', `href="/sheet.css" charset="${charset}"`);
      document.insertBefore(pi, document.documentElement);
    }, charset);
    await expect.poll(() => browser.document.styleSheets.length).toBe(1);
    expect(await browser.evaluate(() => {
      const element = document.querySelector('p')!;
      element.className = 'café';
      return getComputedStyle(element).opacity;
    })).toBe('0.5');
  });

  it('blocks stylesheet requests through the document CSP and honors nosniff', async () => {
    let requested = 0;
    const server = createServer((_request, response) => {
      requested++;
      response.writeHead(200, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' }).end('p { opacity: .5 }');
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = await createBrowser(origin, true);
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const url = document.env.parseURL(`${origin}/sheet.css`)!;
    const rejected = await new Promise<boolean>((resolve) => {
      document.fetchCSSStyleSheet(url, document.url, {}, (_response, bytes) => resolve(bytes === null));
    });
    expect(rejected).toBe(true);
    expect(requested).toBe(1);
    const policyResponse = new FetchResponse();
    policyResponse.urlList.push(document.url);
    policyResponse.headerList.append('Content-Security-Policy', "style-src 'none'");
    document.policyContainer.cspList = CSPList.parse(policyResponse);
    const blocked = await new Promise<boolean>((resolve) => {
      document.fetchCSSStyleSheet(url, document.url, {}, (_response, bytes) => resolve(bytes === null));
    });
    expect(blocked).toBe(true);
    expect(requested).toBe(1);
  });

  it('preserves redirect href while using the final URL as the parse base', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/start.css') response.writeHead(302, { Location: '/final/sheet.css' }).end();
      else response.writeHead(200, { 'Content-Type': 'text/css' }).end('p { opacity: .5 }');
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = await createBrowser(origin);
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const pi = document.createProcessingInstruction('xml-stylesheet', 'href="/start.css"');
    document.insertBefore(pi, document.documentElement);
    await expect.poll(() => pi.sheet).not.toBeNull();
    expect(pi.sheet!.href).toBe(`${origin}/start.css`);
    expect(serializeURL(pi.sheet!.baseURL!)).toBe(`${origin}/final/sheet.css`);
    expect(pi.sheet!.ownerNode).toBe(pi);
  });

  it.each([404, 500])('rejects CSS from HTTP status %s', async (status) => {
    const server = createServer((_request, response) => {
      response.writeHead(status, { 'Content-Type': 'text/css' }).end('p { opacity: .5 }');
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = await createBrowser(origin);
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const url = document.env.parseURL(`${origin}/sheet.css`)!;
    const accepted = await new Promise<boolean>((resolve) => {
      document.fetchCSSStyleSheet(url, document.url, {}, (_response, bytes, outcome) => {
        expect(outcome).toBe('http-error');
        resolve(bytes !== null);
      });
    });
    expect(accepted).toBe(false);
  });

  it('reports an incomplete response body as failure instead of parsing partial CSS', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/css', 'Content-Length': '1000' });
      response.write('p { opacity: .5 }');
      setImmediate(() => response.destroy());
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = await createBrowser(origin);
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const url = document.env.parseURL(`${origin}/sheet.css`)!;
    const accepted = await new Promise<boolean>((resolve) => {
      document.fetchCSSStyleSheet(url, document.url, {}, (_response, bytes, outcome) => {
        expect(outcome).toBe('failure');
        resolve(bytes !== null);
      });
    });
    expect(accepted).toBe(false);
  });

  it('creates an imported-sheet relationship only when loading is explicitly started', async () => {
    const browser = await createBrowser('https://example.test');
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const url = document.env.parseURL('/sheet.css', document.url)!;
    const response = new FetchResponse();
    response.urlList.push(url);
    response.headerList.append('Content-Type', 'text/css');
    const sheet = document.createFetchedStyleSheet(url, response, Buffer.from('@import "other.css";'), {
      ownerNode: null, media: '', title: '', alternate: false,
    });
    const rule = sheet.ruleList.item(0) as CSSImportRuleImpl;
    expect(rule.parentStyleSheet).toBe(sheet);
    expect(rule.styleSheet).toBeNull();
    expect(sheet.encoding).toBe('UTF-8');
  });

  it.each([
    { credentials: 'anonymous', allow: true, integrity: true, success: true },
    { credentials: 'use-credentials', allow: true, integrity: true, success: true },
    { credentials: 'anonymous', allow: false, integrity: true, success: false },
    { credentials: 'anonymous', allow: true, integrity: false, success: false },
  ])('applies import URL modifiers ($credentials, CORS=$allow, integrity=$integrity)', async ({ credentials, allow, integrity, success }) => {
    const source = 'p { opacity: .5 }';
    const digest = createHash('sha256').update(integrity ? source : 'different contents').digest('base64');
    const referrers: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      referrers.push(request.headers.referer);
      response.setHeader('Content-Type', 'text/css');
      if (allow) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      response.end(source);
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = await createBrowser(origin);
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const url = document.env.parseURL(`${origin}/root.css`)!;
    const response = new FetchResponse();
    response.urlList.push(url);
    response.headerList.append('Content-Type', 'text/css');
    const importedURL = `${origin.replace('127.0.0.1', 'localhost')}/child.css`;
    const sheet = document.createFetchedStyleSheet(url, response, Buffer.from(
      `@import url("${importedURL}" cross-origin(${credentials}) integrity("sha256-${digest}") referrer-policy(no-referrer));`,
    ), { ownerNode: null, media: '', title: '', alternate: false });
    const completed = await new Promise<boolean>((resolve) => {
      document.loadStyleSheetImports(sheet, () => ({ referrerPolicy: 'unsafe-url' }), resolve);
    });
    expect(completed).toBe(success);
    expect(referrers).toEqual([undefined]);
    const imported = (sheet.ruleList.item(0) as CSSImportRuleImpl).styleSheet;
    if (success) {
      expect(imported!.cssRules.length).toBe(1);
      expect(imported!.originClean).toBe(true);
    } else {
      expect(imported).toBeNull();
    }
  });

  it('loads nested imports using the final base URL and actual parent encoding before reporting completion', async () => {
    let leafResponse: ServerResponse | undefined;
    const referrers: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      referrers.push(request.headers.referer);
      if (request.url === '/child.css') { response.writeHead(302, { Location: '/nested/child.css' }).end(); }
      else if (request.url === '/nested/child.css') {
        response.writeHead(200, { 'Content-Type': 'text/css' }).end(Buffer.from('@import "leaf.css"; .caf\xe9 { opacity: .5 }', 'latin1'));
      } else { leafResponse = response; }
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = await createBrowser(origin);
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const url = document.env.parseURL(`${origin}/root.css`)!;
    const response = new FetchResponse();
    response.urlList.push(url);
    response.headerList.append('Content-Type', 'text/css; charset=windows-1252');
    const sheet = document.createFetchedStyleSheet(url, response, Buffer.from('@import "child.css";'), {
      ownerNode: null, media: '', title: '', alternate: false,
    });
    let completed: boolean | undefined;
    document.loadStyleSheetImports(sheet, () => ({ renderBlocking: false }), (success) => { completed = success; });
    await expect.poll(() => leafResponse !== undefined).toBe(true);
    expect(completed).toBeUndefined();
    const child = (sheet.ruleList.item(0) as CSSImportRuleImpl).styleSheet!;
    expect(child.href).toBe(`${origin}/child.css`);
    expect(serializeURL(child.baseURL!)).toBe(`${origin}/nested/child.css`);
    expect(child.encoding).toBe('windows-1252');
    expect((child.ruleList.item(1) as CSSStyleRuleImpl).selectorText).toBe('.café');
    expect(referrers.at(-1)).toBe(`${origin}/nested/child.css`);
    leafResponse!.writeHead(200, { 'Content-Type': 'text/css; charset=windows-1252' }).end(Buffer.from('\uFEFF.café { opacity: .7 }'));
    await expect.poll(() => completed).toBe(true);
    const leaf = (child.ruleList.item(0) as CSSImportRuleImpl).styleSheet!;
    expect(leaf.encoding).toBe('UTF-8');
    expect((leaf.ruleList.item(0) as CSSStyleRuleImpl).selectorText).toBe('.café');
  });

  it('fetches a later CSSOM import through the retained connection with its parent response policy', async () => {
    const requests: { url: string | undefined; referrer: string | undefined; }[] = [];
    const server = createServer((request, response) => {
      requests.push({ url: request.url, referrer: request.headers.referer });
      response.writeHead(200, { 'Content-Type': 'text/css', 'Referrer-Policy': 'origin' }).end('');
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = await createBrowser(origin);
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const url = document.env.parseURL(`${origin}/root.css`)!;
    const response = new FetchResponse();
    response.urlList.push(url);
    response.headerList.append('Content-Type', 'text/css');
    response.headerList.append('Referrer-Policy', 'no-referrer');
    const sheet = document.createFetchedStyleSheet(url, response, Buffer.from('@import "nested/child.css";'), {
      ownerNode: null, media: '', title: '', alternate: false,
    });
    const events: string[] = [];
    const parents: (string | null)[] = [];
    document.loadStyleSheetImports(sheet, (parent) => {
      parents.push(parent.href);
      return {};
    }, (success) => events.push(`complete:${success}`), () => events.push('start'));
    await expect.poll(() => events.length).toBe(2);
    const child = (sheet.ruleList.item(0) as CSSImportRuleImpl).styleSheet!;
    child.insertRule('@import "later.css";');
    expect(events).toEqual(['start', 'complete:true', 'start']);
    await expect.poll(() => events.length).toBe(4);
    expect(events).toEqual(['start', 'complete:true', 'start', 'complete:true']);
    expect(requests).toEqual([
      { url: '/nested/child.css', referrer: undefined },
      { url: '/nested/later.css', referrer: `${origin}/` },
    ]);
    expect(parents).toEqual([`${origin}/root.css`, `${origin}/nested/child.css`]);
    expect((child.ruleList.item(0) as CSSImportRuleImpl).styleSheet!.href).toBe(`${origin}/nested/later.css`);
  });

  it.each([false, true])('uses each stylesheet response policy for its imports (cross-origin child: %s)', async (cross) => {
    const referrers: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      referrers.push(request.headers.referer);
      response.writeHead(200, { 'Content-Type': 'text/css', 'Referrer-Policy': 'origin' })
        .end(request.url === '/child.css' ? '@import "leaf.css";' : '');
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = await createBrowser(origin);
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    document.policyContainer.referrerPolicy = 'unsafe-url';
    const childOrigin = cross ? origin.replace('127.0.0.1', 'localhost') : origin;
    const url = document.env.parseURL(`${origin}/root.css`)!;
    const response = new FetchResponse();
    response.urlList.push(url);
    response.headerList.append('Content-Type', 'text/css');
    response.headerList.append('Referrer-Policy', 'no-referrer');
    const sheet = document.createFetchedStyleSheet(url, response, Buffer.from(`@import "${childOrigin}/child.css";`), {
      ownerNode: null, media: '', title: '', alternate: false,
    });
    const success = await new Promise<boolean>((resolve) => document.loadStyleSheetImports(sheet, () => ({}), resolve));
    expect(success).toBe(true);
    expect(referrers).toEqual([undefined, `${childOrigin}/`]);
    expect(document.policyContainer.referrerPolicy).toBe('unsafe-url');
  });

  it.each(['', 'unknown-policy'])('uses an external stylesheet default when its policy header is %j', async (header) => {
    let referrer: string | undefined;
    const server = createServer((request, response) => {
      referrer = request.headers.referer;
      response.writeHead(200, { 'Content-Type': 'text/css' }).end('');
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = await createBrowser(origin);
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    document.policyContainer.referrerPolicy = 'no-referrer';
    const url = document.env.parseURL(`${origin}/root.css`)!;
    const response = new FetchResponse();
    response.urlList.push(url);
    response.headerList.append('Content-Type', 'text/css');
    if (header !== '') response.headerList.append('Referrer-Policy', header);
    const sheet = document.createFetchedStyleSheet(url, response, Buffer.from('@import "child.css";'), {
      ownerNode: null, media: '', title: '', alternate: false,
    });
    expect(sheet.referrerPolicy).toBe('');
    const success = await new Promise<boolean>((resolve) => document.loadStyleSheetImports(sheet, () => ({}), resolve));
    expect(success).toBe(true);
    expect(referrer).toBe(`${origin}/root.css`);
  });

  it('uses the document URL and current policy for an inline stylesheet import', async () => {
    let referrer: string | undefined;
    let path: string | undefined;
    const server = createServer((request, response) => {
      referrer = request.headers.referer;
      path = request.url;
      response.writeHead(200, { 'Content-Type': 'text/css' }).end('');
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = await createBrowser(origin);
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    document.policyContainer.referrerPolicy = 'no-referrer';
    const sheet = new CSSStyleSheetImpl({
      location: null, baseURL: document.env.parseURL(`${origin}/assets/`)!, encoding: 'UTF-8',
      ownerNode: document.createElement('style'), parentStyleSheet: null, ownerRule: null,
      media: '', title: '', alternate: false, originClean: true,
    }, document.env);
    expect(sheet.referrerPolicy).toBe('');
    sheet.insertRule('@import "child.css";');
    document.policyContainer.referrerPolicy = 'unsafe-url';
    const success = await new Promise<boolean>((resolve) => document.loadStyleSheetImports(sheet, () => ({}), resolve));
    expect(success).toBe(true);
    expect(path).toBe('/assets/child.css');
    expect(referrer).toBe(`${origin}/page`);
  });

  it.each([404, 500])('associates an empty sheet for HTTP %i and waits for the other imports', async (status) => {
    let slow: ServerResponse | undefined;
    const server = createServer((request, response) => {
      if (request.url === '/slow.css') slow = response;
      else response.writeHead(status, { 'Content-Type': 'text/css' }).end('p { opacity: .5 }');
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = await createBrowser(origin);
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const url = document.env.parseURL(`${origin}/root.css`)!;
    const response = new FetchResponse();
    response.urlList.push(url);
    response.headerList.append('Content-Type', 'text/css');
    const sheet = document.createFetchedStyleSheet(url, response, Buffer.from('@import "missing.css"; @import "slow.css";'), {
      ownerNode: null, media: '', title: '', alternate: false,
    });
    let completed: boolean | undefined;
    document.loadStyleSheetImports(sheet, () => ({ renderBlocking: false }), (success) => { completed = success; });
    await expect.poll(() => slow !== undefined).toBe(true);
    expect(completed).toBeUndefined();
    slow!.writeHead(200, { 'Content-Type': 'text/css' }).end('');
    await expect.poll(() => completed).toBe(false);
    const failedImport = sheet.ruleList.item(0) as CSSImportRuleImpl;
    expect(failedImport.styleSheet).not.toBeNull();
    expect(failedImport.styleSheet!.ruleList.length).toBe(0);
    expect(failedImport.styleSheet!.parentStyleSheet).toBe(sheet);
    expect(failedImport.styleSheet!.ownerRule).toBe(failedImport);
    expect((sheet.ruleList.item(1) as CSSImportRuleImpl).styleSheet).not.toBeNull();
  });

  it('keeps header order ahead of tree sheets when responses finish out of order', async () => {
    let slow: ServerResponse | undefined;
    const server = createServer((request, response) => {
      if (request.url === '/slow.css') { slow = response; return; }
      response.writeHead(200, { 'Content-Type': 'text/css' }).end('p { opacity: .5 }');
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = await createBrowser(origin);
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const response = new FetchResponse();
    response.headerList.append('Link', '</slow.css>; rel=STYLESHEET, </fast.css>; rel=stylesheet');
    response.headerList.append('LINK', '</ignored.css>; rel="alternate stylesheet", </anchored.css>; rel=stylesheet; anchor="/other"');
    document.processStyleSheetLinkHeaders(response);
    const style = document.createElement('style');
    style.textContent = 'p { opacity: .2 }';
    document.head!.appendChild(style);
    await expect.poll(() => document.styleSheets.length).toBe(2);
    await expect.poll(() => slow !== undefined).toBe(true);
    slow!.writeHead(200, { 'Content-Type': 'text/css' }).end('p { opacity: .1 }');
    await expect.poll(() => document.styleSheets.length).toBe(3);
    expect([...document.styleSheets].map((sheet) => sheet.href)).toEqual([`${origin}/slow.css`, `${origin}/fast.css`, null]);
    expect(document.styleSheets.item(0)!.ruleList.item(0)).toBeInstanceOf(CSSStyleRuleImpl);
  });
});

/** Give requests a real active document and event-loop owner without fetching the HTML fixture. */
async function createBrowser(origin: string, quirks = false): Promise<Browlet> {
  const browser = new Browlet({ route: () => `${quirks ? '' : '<!doctype html>'}<html><head></head><body><p>test</p></body></html>` });
  await browser.navigate(`${origin}/page`);
  const env = getRelevantRealm(browser.window).env;
  cleanup.push(() => env.userAgent.httpTransport.close());
  return browser;
}
