import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { internalType } from '../../../src/infra/promises';
import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';
import { ResourceReader } from '../../../src/browlet/loader/resource-reader';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { fetch } from '../../../src/fetch/fetch';
import { FetchRequest } from '../../../src/fetch/request';
import { closeServer, listen } from './http-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('Navigable HTML response loading', () => {
  it('populates about:blank synchronously without a byte parser', () => {
    const browlet = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browlet.window).env;
    const navigable = env.realm.getAssociatedDocument().getNodeNavigable()!;
    const params = navigable.createNavigationParamsFromSource(env.parseURL('about:blank').url!);
    const resource = new ResourceReader(params.response, env.userAgent);
    // about:blank is populated directly and never consumes response bytes.
    const document = navigable.loadHTMLDocument(params, () => {}, resource);
    expect(document.documentElement?.localName).toBe('html');
    expect(document.head?.localName).toBe('head');
    expect(document.body?.localName).toBe('body');
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
    const request = new FetchRequest(env.parseURL(`${origin}/page`).url!, env, env.userAgent);
    request.mode = 'navigate';
    request.destination = 'document';
    request.redirectMode = 'manual';
    request.credentialsMode = 'include';
    // This test supplies the navigation inputs. Full navigation request
    // construction and redirect handling remain with HTML §7.4.
    const loading = Promise.withResolvers<DocumentImpl>();
    const controller = fetch(request, {
      useParallelQueue: true,
      processResponse(response) {
        try {
          expect(response.headerList.getDecodeAndSplit('Content-Language')).toEqual(['fr', 'en']);
          const params = navigable.createNavigationParams(response);
          params.request = request;
          params.fetchController = controller;
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
    await expect.poll(() => document.readyState).toBe('complete');
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
    expect(document.navigationTimingEntry?.fetchTimingInfo).toBe(controller.extractFullTimingInfo());
    expect(document.navigationTimingEntry?.documentTimingInfo).toBe(document.loadTimingInfo);
    expect(document.navigationTimingEntry?.bodyInfo.decodedSize).toBe(suppliedType ? 41 : 42);
  });
});
