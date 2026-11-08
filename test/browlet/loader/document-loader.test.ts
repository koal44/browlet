import { createServer } from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { internalType } from '../../../src/infra/promises';
import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createManualUserAgent } from '../../support/browlet-agent';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/top-level-traversable';
import { ResourceReader } from '../../../src/browlet/loader/resource-reader';
import { LinkProcessingOptions } from '../../../src/browlet/loader/links/options';
import { SourceSnapshotParams } from '../../../src/browlet/browsing/navigation/state/index';
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
    // about:blank is populated directly and never consumes response bytes.
    const document = navigable.loadHTMLDocument(params);
    expect(document.documentElement?.localName).toBe('html');
    expect(document.head?.localName).toBe('head');
    expect(document.body?.localName).toBe('body');
    expect(document.compatMode).toBe('BackCompat');
    expect(document.parser).toBeNull();
  });

  it('finishes an ordinary about:blank load after activation without reading its empty Fetch body', async () => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    const navigable = env.realm.getAssociatedDocument().getNodeNavigable()!;
    const params = navigable.createNavigationParamsFromSource(env.parseURL('about:blank')!);
    params.request = new FetchRequest(params.url, env);
    params.request.referrer = null;
    params.response.body = FetchBody.fromBytes(new Uint8Array(), env.userAgent.sandbox);
    const resource = new ResourceReader(params.response, env.userAgent);
    const read = vi.spyOn(resource, 'read');
    const document = navigable.loadHTMLDocument(params, undefined, resource);
    expect(document.body).not.toBeNull();
    expect(document.readyState).toBe('loading');
    expect(document.compatMode).toBe('BackCompat');
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    await expect.poll(() => document.readyState).toBe('complete');
    expect(read).not.toHaveBeenCalled();
    expect(document.parser).toBeNull();
  });

  it.each(['', '<!doctype html><p>replacement</p>'])('parses supplied about:blank HTML, including an empty body (%j)', async (markup) => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    const navigable = env.realm.getAssociatedDocument().getNodeNavigable()!;
    const params = navigable.createNavigationParamsFromSource(env.parseURL('about:blank')!);
    params.response.body = FetchBody.fromBytes(utf8Encode(markup), env.userAgent.sandbox);
    const document = navigable.loadHTMLDocument(params);
    expect(document.body).toBeNull();
    expect(document.activeParser?.kind).toBe('html');
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    await expect.poll(() => document.readyState).toBe('complete');
    expect(document.body?.textContent).toBe(markup === '' ? '' : 'replacement');
    expect(document.compatMode).toBe(markup === '' ? 'BackCompat' : 'CSS1Compat');
    expect(document.URL).toBe('about:blank');
    expect(document.referrer).toBe('');
    expect(document.encoding).toBe('UTF-8');
    expect(document.parser).toBeNull();
  });

  it('loads script-free HTML through MIME dispatch without a supplied script handler', async () => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    const navigable = env.realm.getAssociatedDocument().getNodeNavigable()!;
    const response = new FetchResponse();
    response.urlList = [env.parseURL('https://example.test/loaded')!];
    response.headerList.append('Content-Type', 'text/html;charset=windows-1252');
    response.body = FetchBody.fromBytes(new Uint8Array(Buffer.from('<!doctype html><p>caf\u00e9</p>', 'latin1')), env.userAgent.sandbox);
    const resource = new ResourceReader(response, env.userAgent);
    await new Promise<void>((resolve, reject) => resource.determineMIMEType().observe(() => { resolve(); }, reject));
    const params = navigable.createNavigationParams(response);
    const document = (await navigable.loadDocument(params, new SourceSnapshotParams(null), null, resource))!;
    expect(document.allowDeclarativeShadowRoots).toBe(true);
    expect(document.documentElement).toBeNull();
    const finish = vi.spyOn(document, 'finishLoading');
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    await expect.poll(() => document.readyState).toBe('complete');
    expect(document.querySelector('p')?.textContent).toBe('caf\u00e9');
    expect(document.encoding).toBe('windows-1252');
    expect(finish).toHaveBeenCalledOnce();
    expect(document.parser).toBeNull();
  });

  it('loads a scripting-disabled response without waiting for script permission or a script handler', async () => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    const navigable = env.realm.getAssociatedDocument().getNodeNavigable()!;
    const params = navigable.createNavigationParamsFromSource(env.parseURL('https://example.test/disabled')!);
    params.finalSandboxingFlagSet.add('sandboxed-scripts');
    params.response.body = FetchBody.fromBytes(utf8Encode('<!doctype html><body><script>throw 1</script><noscript><p>fallback</p></noscript>'), env.userAgent.sandbox);
    const document = navigable.loadHTMLDocument(params);
    const wait = vi.spyOn(document, 'waitForScriptsMayRun');
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    await expect.poll(() => document.readyState).toBe('complete');
    expect(document.querySelector('p')?.textContent).toBe('fallback');
    expect(wait).not.toHaveBeenCalled();
  });

  it.each([
    ['script', '<script></script>', 'Parser script preparation is not implemented'],
    ['template', '<template></template>', 'Parser tree adapter setTemplateContent is not implemented'],
    ['body', '', null],
  ] as const)('aborts failed loading and surfaces unfinished implementations (%s)', async (kind, markup, message) => {
    const userAgent = createManualUserAgent();
    const navigable = TopLevelTraversable.create(userAgent, null, '');
    const env = navigable.activeDocument!.env;
    const params = navigable.createNavigationParamsFromSource(env.parseURL('https://example.test/script')!);
    params.response.body = FetchBody.fromBytes(utf8Encode(`<!doctype html>${markup}<p>after</p>`), userAgent.sandbox);
    if (kind === 'body') params.response.body.stream.error(new Error('body failed'));
    const document = navigable.loadHTMLDocument(params);
    const finish = vi.spyOn(document, 'finishLoading');
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    const failures: unknown[] = [];
    await expect.poll(() => {
      try { while (document.env.responsibleEventLoop.runTaskTurn()) { /* Drain the owning loop. */ } }
      catch (error) { failures.push(error); }
      return document.activeParserWasAborted;
    }).toBe(true);
    if (message === null) {
      expect(failures).toEqual([]);
    } else {
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ name: 'InternalError', message });
    }
    expect(document.activeParserWasAborted).toBe(true);
    expect(document.parser).toBeNull();
    expect(document.querySelector('p')).toBeNull();
    expect(finish).not.toHaveBeenCalled();
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
      document.env.queueTask('navigation-and-traversal', {
        run: () => {
          document.updateForHistoryStepApplication(target, false, 2, 1, 'push', [previous, target], previous);
        },
      });
      await waitForLoad(document);
      expect(script).toHaveBeenCalledOnce();
      expect(document.querySelector('p')!.textContent).toBe('after');
    }
  });

  it('processes each header phase once, with media links using the base from the first parsed bytes', async () => {
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    const navigable = env.realm.getAssociatedDocument().getNodeNavigable()!;
    const response = new FetchResponse();
    response.urlList = [env.parseURL('https://example.test/new')!];
    response.headerList.append('Content-Type', 'text/html');
    response.headerList.append('Link', '<early>; rel=preload; as=fetch, <media>; rel=preload; as=image; media=""');
    response.body = FetchBody.fromBytes(utf8Encode('<!doctype html><base href="/later/"><p>loaded</p>'), env.userAgent.sandbox);
    const resource = new ResourceReader(response, env.userAgent);
    await new Promise<void>((resolve, reject) => resource.determineMIMEType().observe(() => { resolve(); }, reject));
    const params = navigable.createNavigationParams(response);
    const prepared: LinkProcessingOptions[] = [];
    vi.spyOn(LinkProcessingOptions.prototype, 'preload').mockImplementation(function(this: LinkProcessingOptions) {
      prepared.push(this);
    });

    const document = navigable.loadHTMLDocument(params, () => {}, resource);
    expect(prepared.map((options) => options.href)).toEqual(['early']);
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    await expect.poll(() => document.readyState).toBe('complete');

    expect(prepared.map((options) => options.href)).toEqual(['early', 'media']);
    expect(prepared.map((options) => options.document)).toEqual([document, document]);
    expect(prepared.map((options) => options.baseURL.path)).toEqual([['new'], ['later', '']]);
    expect(document.getBaseURL().path).toEqual(['later', '']);
    expect(document.querySelector('p')!.textContent).toBe('loaded');
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
          resource.determineMIMEType().then(() => navigable.loadDocument(params, new SourceSnapshotParams(null), null, resource), undefined, internalType<DocumentImpl | null>()).then((document) => {
            if (document === null) throw new Error('Expected a loaded Document');
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
            expect(type).toMatchObject({ type: 'text', subtype: 'html' });
            return navigable.loadDocument(params, new SourceSnapshotParams(null), null, resource);
          }, undefined, internalType<DocumentImpl | null>()).then((document) => {
            if (document === null) throw new Error('Expected a loaded Document');
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
