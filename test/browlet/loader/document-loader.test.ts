import { createServer } from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { internalType } from '../../../src/infra/promises';
import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';
import { ResourceReader } from '../../../src/browlet/loader/resource-reader';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { PerformanceEntry, PerformanceNavigationTiming, Window } from '../../../src/browlet/platform';
import { fetch } from '../../../src/fetch/fetch';
import { FetchRequest } from '../../../src/fetch/request';
import { FetchBody, FetchResponse } from '../../../src/fetch/index';
import { utf8Encode } from '../../../src/encoding/index';
import { closeServer, listen } from './http-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('Navigable HTML response loading', () => {
  it('populates about:blank synchronously without a byte parser', () => {
    const browlet = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browlet.window).env;
    const navigable = env.realm.getAssociatedDocument().getNodeNavigable()!;
    const params = navigable.createNavigationParamsFromSource(env.parseURL('about:blank')!);
    const resource = new ResourceReader(params.response, env.userAgent);
    // about:blank is populated directly and never consumes response bytes.
    const document = navigable.loadHTMLDocument(params, () => {}, resource);
    expect(document.documentElement?.localName).toBe('html');
    expect(document.head?.localName).toBe('head');
    expect(document.body?.localName).toBe('body');
  });

  it.each([false, true])('waits for history initialization before parser scripts (abort: %s)', async (abort) => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/old');
    const env = getRelevantRealm(browser.window).env;
    const navigable = env.realm.getAssociatedDocument().getNodeNavigable()!;
    const previous = navigable.activeSessionHistoryEntry;
    const response = new FetchResponse();
    response.urlList.push(env.parseURL('https://example.test/new')!);
    response.headerList.append('Content-Type', 'text/html');
    response.body = FetchBody.fromBytes(utf8Encode('<!doctype html><script></script><p>after</p>'), env.userAgent.sandbox);
    const resource = new ResourceReader(response, env.userAgent);
    await new Promise<void>((resolve, reject) => resource.determineMIMEType().observe(() => { resolve(); }, reject));
    const params = navigable.createNavigationParams(response);
    const script = vi.fn(() => {});
    const document = navigable.loadHTMLDocument(params, script, resource);
    const target = navigable.createHistoryEntry(document, params);
    const wait = vi.spyOn(document, 'waitForScriptsMayRun');
    navigable.currentSessionHistoryEntry = navigable.activeSessionHistoryEntry = target;
    document.makeActive();
    await expect.poll(() => wait.mock.calls.length).toBe(1);
    expect(script).not.toHaveBeenCalled();
    expect(document.latestEntry).toBeNull();

    if (abort) {
      document.activeParser!.abort();
      // A late permit must not invoke a script belonging to the stopped parser.
      document.setReadyToRunScripts();
      await new Promise<void>((resolve, reject) => { document.waitForScriptsMayRun().observe(resolve, reject); });
      expect(script).not.toHaveBeenCalled();
    } else {
      vi.spyOn(target, 'restorePersistedState').mockImplementation(() => {});
      vi.spyOn(document, 'tryToScrollToFragment').mockImplementation(() => {});
      target.classicHistoryAPIState = document.env.serializeForStorage({ committed: true });
      script.mockImplementation(() => {
        expect(document.latestEntry).toBe(target);
        expect(document.history.stateValue).toEqual({ committed: true });
        expect(document.getRelevantGlobalObject()!.navigation.currentEntry!.sessionHistoryEntry).toBe(target);
      });
      document.env.queueTask('navigation-and-traversal', () => {
        document.updateForHistoryStepApplication(target, false, 2, 1, 'push', [previous, target], previous);
      });
      await waitForLoad(document);
      expect(script).toHaveBeenCalledOnce();
      expect(document.querySelector('p')!.textContent).toBe('after');
    }
  });

  it.each(['combined', 'repeated'])('loads stylesheet Link fields through navigation (%s)', async (format) => {
    const links = ['</first.css>; rel=stylesheet', '</second.css>; rel=stylesheet'];
    const server = createServer((request, response) => {
      if (request.url === '/page') {
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          Link: format === 'combined' ? links.join(', ') : links,
        }).end('<!doctype html><p>styled by the response header</p>');
      } else {
        response.writeHead(200, { 'Content-Type': 'text/css' })
          .end(`p { opacity: ${request.url === '/first.css' ? '.2' : '.5'} }`);
      }
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browlet = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browlet.window).env;
    cleanup.push(() => env.userAgent.httpTransport.close());
    const navigable = env.realm.getAssociatedDocument().getNodeNavigable()!;
    const request = new FetchRequest(env.parseURL(`${origin}/page`)!, env);
    request.client = env;
    request.mode = 'navigate';
    request.destination = 'document';
    request.redirectMode = 'manual';
    request.credentialsMode = 'include';
    const loading = Promise.withResolvers<DocumentImpl>();
    const controller = fetch(request, {
      useParallelQueue: true,
      processResponse(response) {
        try {
          const params = navigable.createNavigationParams(response);
          params.request = request;
          params.fetchController = controller;
          const resource = new ResourceReader(response, env.userAgent);
          resource.determineMIMEType().then(() => {
            const document = navigable.loadHTMLDocument(params, () => {}, resource);
            navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
            return document;
          }, undefined, internalType<DocumentImpl>()).observe(loading.resolve, loading.reject);
        } catch (error) { loading.reject(error); }
      },
    }, env.userAgent.sandbox);
    const document = await loading.promise;
    await waitForLoad(document);
    await expect.poll(() => document.styleSheets.length).toBe(2);
    expect([...document.styleSheets].map((sheet) => [sheet.href, sheet.ownerNode])).toEqual([
      [`${origin}/first.css`, null], [`${origin}/second.css`, null],
    ]);
    // This test commits through Navigable directly, outside Browlet.navigate()'s evaluator setup.
    expect(browlet.window.getComputedStyle(browlet.document.querySelector('p')!).getPropertyValue('opacity')).toBe('0.5');
  });

  // SPEC_CLASH(language-protocol-fallback): Chromium/WebKit select the first language; HTML says unknown and Firefox matches all.
  it.each([
    { suppliedType: true, languageHeaders: ['fr, en'] },
    { suppliedType: true, languageHeaders: ['fr', 'en'] },
    { suppliedType: false, languageHeaders: ['fr, en'] },
    { suppliedType: false, languageHeaders: ['fr', 'en'] },
  ])('sniffs streamed HTML with response policy and language (type: $suppliedType, headers: $languageHeaders)', async ({ suppliedType, languageHeaders }) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        ...(suppliedType ? { 'Content-Type': 'text/html; charset=windows-1252' } : {}),
        'Content-Security-Policy': "default-src 'none'",
        'Content-Language': languageHeaders,
        'Server-Timing': 'document;dur=4',
      });
      response.write(Buffer.from('<html><p>caf', 'latin1'));
      response.write(suppliedType ? Buffer.from([0xe9, 0x3c, 0x2f, 0x70, 0x3e]) : Buffer.from('é</p>'));
      response.end('<p lang="de">Deutsch</p>');
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browlet = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browlet.window).env;
    cleanup.push(() => env.userAgent.httpTransport.close());
    const navigable = env.realm.getAssociatedDocument().getNodeNavigable()!;
    const request = new FetchRequest(env.parseURL(`${origin}/page`)!, env);
    request.client = env;
    request.mode = 'navigate';
    request.destination = 'document';
    request.redirectMode = 'manual';
    request.credentialsMode = 'include';
    // This test supplies the navigation inputs. Full navigation request
    // construction and redirect handling remain with HTML §7.4.
    const loading = Promise.withResolvers<DocumentImpl>();
    const notifications: { entries: PerformanceEntry[]; loadEnd: number; }[] = [];
    const controller = fetch(request, {
      useParallelQueue: true,
      processResponse(response) {
        try {
          expect(response.headerList.getDecodeAndSplit('Content-Language')).toEqual(['fr', 'en']);
          const params = navigable.createNavigationParams(response);
          params.request = request;
          params.fetchController = controller;
          params.commitEarlyHints = (incoming) => {
            const window = incoming.env.realm.globalObject as Window;
            new window.PerformanceObserver((list) => {
              const entries = list.getEntries();
              notifications.push({ entries, loadEnd: (entries[0] as PerformanceNavigationTiming).loadEventEnd });
            }).observe({ type: 'navigation' });
          };
          const resource = new ResourceReader(response, env.userAgent);
          resource.determineMIMEType().then((type) => {
            // Handler dispatch is still navigation work. This bounded consumer
            // selects HTML only after sniffing has identified it as HTML.
            expect(type).toMatchObject({ type: 'text', subtype: 'html' });
            const document = navigable.loadHTMLDocument(params, () => {}, resource);
            navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
            return document;
          }, undefined, internalType<DocumentImpl>()).observe(loading.resolve, loading.reject);
        } catch (error) { loading.reject(error); }
      },
    }, env.userAgent.sandbox);
    const document = await loading.promise;
    await waitForLoad(document);
    const text = document.body?.firstChild?.firstChild;
    expect(text?.isText() ? text.data : undefined).toBe('café');
    const inherited = document.querySelector('p')!;
    expect(inherited.getLanguage()).toBe('fr');
    expect(inherited.matches(':lang(fr)')).toBe(true);
    expect(inherited.matches(':lang(en)')).toBe(false);
    const explicit = document.querySelector('[lang]')!;
    expect(explicit.getLanguage()).toBe('de');
    expect(explicit.matches(':lang(de)')).toBe(true);
    expect(explicit.matches(':lang(fr)')).toBe(false);
    expect(document.policyContainer.cspList?.policies).toHaveLength(1);
    expect(navigable.activeSessionHistoryEntry.documentState.resource).toBeNull();
    expect(document.navigationTimingEntry?.timingInfo).toBe(controller.extractFullTimingInfo());
    expect(document.navigationTimingEntry?.documentTimingInfo).toBe(document.loadTimingInfo);
    expect(document.navigationTimingEntry?.resourceInfo.decodedSize).toBe(suppliedType ? 41 : 42);
    const window = document.env.realm.globalObject as Window;
    const entries = window.performance.getEntriesByType('navigation');
    expect(entries).toHaveLength(1);
    const entry = entries[0] as PerformanceNavigationTiming;
    expect(entry.name).toBe(`${origin}/page`);
    expect(entry.responseStatus).toBe(200);
    expect(entry.responseEnd).toBeGreaterThan(0);
    expect(entry.responseEnd).toBeGreaterThanOrEqual(entry.responseStart);
    expect(entry.encodedBodySize).toBe(suppliedType ? 41 : 42);
    expect(entry.decodedBodySize).toBe(suppliedType ? 41 : 42);
    expect(entry.loadEventEnd).toBeGreaterThan(0);
    expect(entry.duration).toBe(entry.loadEventEnd);
    expect(entry.serverTiming.map((metric) => [metric.name, metric.duration])).toEqual([['document', 4]]);
    expect(window.performance.getEntriesByType('navigation')[0]).toBe(entry);
    await expect.poll(() => notifications.length).toBe(1);
    expect(notifications[0]!.entries).toEqual([entry]);
    expect(notifications[0]!.loadEnd).toBeGreaterThan(0);
    // Navigation completion does not need a secondary Resource Timing report.
    expect(window.performance.getEntriesByType('resource')).toEqual([]);
  });
});

async function waitForLoad(document: DocumentImpl): Promise<void> {
  if (document.readyState !== 'complete') {
    const window = document.env.realm.globalObject as Window;
    await new Promise<void>((resolve) => {
      window.addEventListener('load', () => resolve(), { once: true });
    });
  }
  // Callback cleanup can run Promise reactions before load dispatch returns.
  // Read completion timing only after that dispatch has recorded loadEventEnd.
  await nextTurn();
  expect(document.readyState).toBe('complete');
}
