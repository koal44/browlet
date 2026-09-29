import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import { NavigationParams } from '../../../src/browlet/browsing/navigation/params';
import { loadHTMLDocument } from '../../../src/browlet/loader/document-loader';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { fetch } from '../../../src/fetch/fetch';
import { FetchRequest } from '../../../src/fetch/request';
import { closeServer, listen } from './http-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('HTML response loading', () => {
  it('populates about:blank synchronously without a byte parser', () => {
    const browlet = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browlet.window).env;
    const navigable = env.realm.getAssociatedDocument()!.getNodeNavigable()!;
    const params = NavigationParams.fromSource(navigable, env.parseURL('about:blank').url!);
    const document = loadHTMLDocument(params, () => {});
    expect(document.documentElement?.localName).toBe('html');
    expect(document.head?.localName).toBe('head');
    expect(document.body?.localName).toBe('body');
  });

  it('loads streamed response bytes using the transport charset and initializes response policy', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=windows-1252',
        'Content-Security-Policy': "default-src 'none'",
      });
      response.write(Buffer.from('<p>caf', 'latin1'));
      response.end(Buffer.from([0xe9, 0x3c, 0x2f, 0x70, 0x3e]));
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browlet = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browlet.window).env;
    cleanup.push(() => env.userAgent.httpTransport.close());
    const navigable = env.realm.getAssociatedDocument()!.getNodeNavigable()!;
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
          const params = NavigationParams.fromResponse(navigable, response);
          params.request = request;
          params.fetchController = controller;
          const document = loadHTMLDocument(params, () => {});
          navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', params.createHistoryEntry(document));
          loading.resolve(document);
        } catch (error) { loading.reject(error); }
      },
    }, env.userAgent.sandbox);
    const document = await loading.promise;
    await expect.poll(() => document.readyState).toBe('complete');
    const text = document.body?.firstChild?.firstChild;
    expect(text?.isText() ? text.data : undefined).toBe('café');
    expect(document.policyContainer.cspList?.policies).toHaveLength(1);
    expect(navigable.activeSessionHistoryEntry.documentState.resource).toBeNull();
    expect(document.navigationTimingEntry?.fetchTimingInfo).toBe(controller.extractFullTimingInfo());
    expect(document.navigationTimingEntry?.documentTimingInfo).toBe(document.loadTimingInfo);
    expect(document.navigationTimingEntry?.bodyInfo.decodedSize).toBe(11);
  });
});
