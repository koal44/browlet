import { createServer, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { CSPList } from '../../../src/browlet/browsing/policy/csp/list';
import { createFetchedStyleSheet, fetchCSSStyleSheet } from '../../../src/browlet/style/stylesheet-loading';
import { processStyleSheetLinkHeaders } from '../../../src/browlet/style/header-stylesheets';
import { FetchResponse } from '../../../src/fetch/response';
import { CSSStyleRuleImpl } from '../../../src/stylelet/cssom/rules/style';
import { getRelevantRealm } from '../../support/browlet-binding';
import { closeServer, listen } from '../loader/http-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('CSSOM stylesheet fetching', () => {
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
    const url = document.env.parseURL(`${cross ? origin.replace('127.0.0.1', 'localhost') : origin}/sheet.css`).url!;
    const result = await new Promise<{ accepted: boolean; clean: boolean; }>((resolve) => {
      fetchCSSStyleSheet(url, document.url, document, {}, (response, bytes) => {
        if (bytes === null) { resolve({ accepted: false, clean: false }); return; }
        const sheet = createFetchedStyleSheet(url, response, bytes, {
          ownerNode: null, media: '', title: '', alternate: false,
        }, document);
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
    const url = document.env.parseURL(`${origin}/sheet.css`).url!;
    const rejected = await new Promise<boolean>((resolve) => {
      fetchCSSStyleSheet(url, document.url, document, {}, (_response, bytes) => resolve(bytes === null));
    });
    expect(rejected).toBe(true);
    expect(requested).toBe(1);
    const policyResponse = new FetchResponse();
    policyResponse.urlList.push(document.url);
    policyResponse.headerList.append('Content-Security-Policy', "style-src 'none'");
    document.policyContainer.cspList = CSPList.parse(policyResponse);
    const blocked = await new Promise<boolean>((resolve) => {
      fetchCSSStyleSheet(url, document.url, document, {}, (_response, bytes) => resolve(bytes === null));
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
    expect(pi.sheet!.baseURL?.href).toBe(`${origin}/final/sheet.css`);
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
    const url = document.env.parseURL(`${origin}/sheet.css`).url!;
    const accepted = await new Promise<boolean>((resolve) => {
      fetchCSSStyleSheet(url, document.url, document, {}, (_response, bytes) => resolve(bytes !== null));
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
    const url = document.env.parseURL(`${origin}/sheet.css`).url!;
    const accepted = await new Promise<boolean>((resolve) => {
      fetchCSSStyleSheet(url, document.url, document, {}, (_response, bytes) => resolve(bytes !== null));
    });
    expect(accepted).toBe(false);
  });

  it('reaches the explicit missing import consumer instead of silently finishing the sheet', async () => {
    const browser = await createBrowser('https://example.test');
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const url = document.env.parseURL('/sheet.css', document.url).url!;
    const response = new FetchResponse();
    response.urlList.push(url);
    response.headerList.append('Content-Type', 'text/css');
    expect(() => createFetchedStyleSheet(url, response, Buffer.from('@import "other.css";'), {
      ownerNode: null, media: '', title: '', alternate: false,
    }, document)).toThrow('Imported stylesheet loading and completion are not implemented');
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
    processStyleSheetLinkHeaders(document, response);
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
