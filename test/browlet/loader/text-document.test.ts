import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { DocumentMode, type DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { ResourceReader } from '../../../src/browlet/loader/resource-reader';
import { SourceSnapshotParams } from '../../../src/browlet/browsing/navigation/state/index';
import { networkingTaskSource } from '../../../src/browlet/scripting/tasks';
import type { PerformanceNavigationTiming, Window } from '../../../src/browlet/platform';
import { getSourceCodeLocation } from '../../../src/browlet/html/parser/tree-adapter';
import { FetchBody, FetchResponse } from '../../../src/fetch/index';
import { fetch } from '../../../src/fetch/fetch';
import { FetchRequest } from '../../../src/fetch/request';
import { utf8Encode } from '../../../src/encoding/index';
import { internalType } from '../../../src/infra/promises';
import { ReadableStreamImpl } from '../../../src/streams/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { closeServer, listen } from './http-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('text Document loading', () => {
  it('presents literal markup in a no-quirks pre and preserves the leading newline', async () => {
    const text = '\n<!doctype html><script>throw new Error("must remain text")</script>&amp;\r\nend\0';
    const { navigable, params, resource, load } = await fixture('text/plain;charset=utf-8', utf8Encode(text));
    const document = load();
    expect(document.contentType).toBe('text/plain');
    expect(document.mode).toBe(DocumentMode.NoQuirks);
    expect(document.body?.firstElementChild?.localName).toBe('pre');
    expect(document.activeParser?.kind).toBe('html');
    expect(document.readyState).toBe('loading');
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    await expect.poll(() => document.readyState).toBe('complete');
    expect(document.body?.firstElementChild?.textContent).toBe(text.replace('\r\n', '\n').replace('\0', '\ufffd'));
    expect(document.querySelector('script')).toBeNull();
    expect(document.doctype).toBeNull();
    expect(document.compatMode).toBe('CSS1Compat');
    expect(document.encoding).toBe('UTF-8');
    expect(document.parser).toBeNull();
    await expect(resource.read()).resolves.toBeNull();
  });

  // SPEC_CLASH(empty-text-document-pre): HTML/Firefox retain an empty pre; Chromium/WebKit omit it.
  it.each([false, true])('creates an empty pre and completes an empty text response (null body: %s)', async (nullBody) => {
    const { navigable, params, response, load } = await fixture('text/plain;charset=utf-8', new Uint8Array());
    if (nullBody) response.body = null;
    const document = load();
    expect(document.querySelector('pre')?.textContent).toBe('');
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    await expect.poll(() => document.readyState).toBe('complete');
    expect(document.body?.children.length).toBe(1);
    expect(document.querySelector('pre')?.textContent).toBe('');
    expect(document.compatMode).toBe('CSS1Compat');
  });

  it.each(['text/css', 'text/javascript', 'application/x-javascript', 'application/json', 'application/example+json', 'text/vtt'])(
    'preserves the computed content type while presenting %s as text', async (contentType) => {
      const text = '"<b>&amp;</b>"';
      const { navigable, params, load } = await fixture(`${contentType};charset=utf-8`, utf8Encode(text));
      const document = load();
      navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
      await expect.poll(() => document.readyState).toBe('complete');
      expect(document.type).toBe('html');
      expect(document.contentType).toBe(contentType);
      expect(document.querySelector('pre')?.textContent).toBe(text);
      expect(document.querySelector('b')).toBeNull();
    },
  );

  it('uses the transport charset without interpreting literal meta charset markup', async () => {
    const text = '<meta charset="utf-8">café';
    const { navigable, params, load } = await fixture('text/plain;charset=windows-1252', new Uint8Array(Buffer.from(text, 'latin1')));
    const document = load();
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    await expect.poll(() => document.readyState).toBe('complete');
    expect(document.encoding).toBe('windows-1252');
    expect(document.querySelector('pre')?.textContent).toBe(text);
    expect(document.querySelector('meta')).toBeNull();
  });

  it('decodes split BOM and character bytes, processes media links after input, and finishes on a networking task', async () => {
    const { navigable, params, stream, load } = await fixture('text/plain;charset=windows-1252');
    const document = load();
    const processLinks = document.processLinkHeaders.bind(document);
    const media = vi.spyOn(document, 'processLinkHeaders');
    const window = document.env.realm.globalObject as Window;
    const events: string[] = [];
    window.document.addEventListener('DOMContentLoaded', () => { events.push(`dom:${document.readyState}`); });
    window.addEventListener('load', () => {
      events.push(`load:${document.readyState}`);
      expect(document.env.responsibleEventLoop.currentlyRunningTask?.source).toBe(networkingTaskSource);
    });
    media.mockImplementation((response, phase) => {
      if (phase === 'media') {
        expect(document.env.responsibleEventLoop.currentlyRunningTask?.source).toBe(networkingTaskSource);
        expect(document.querySelector('pre')?.textContent).toBe('\ncaf');
      }
      processLinks(response, phase);
    });
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    stream.enqueueChunk(Uint8Array.of(0xef));
    stream.enqueueChunk(Uint8Array.of(0xbb));
    stream.enqueueChunk(Uint8Array.from([0xbf, ...utf8Encode('\ncaf'), 0xc3]));
    await expect.poll(() => document.querySelector('pre')?.textContent).toBe('\ncaf');
    expect(document.readyState).toBe('loading');
    expect(document.encoding).toBe('UTF-8');
    stream.enqueueChunk(Uint8Array.of(0xa9, 0x0d));
    stream.enqueueChunk(utf8Encode('\nlast'));
    stream.close();
    await expect.poll(() => document.readyState).toBe('complete');
    expect(document.querySelector('pre')?.textContent).toBe('\ncafé\nlast');
    expect(media.mock.calls.filter(([, phase]) => phase === 'media')).toHaveLength(1);
    expect(events).toEqual(['dom:interactive', 'load:complete']);
    expect(document.loadTimingInfo.domContentLoadedEventStartTime).toBeGreaterThan(0);
    expect(document.loadTimingInfo.loadEventEndTime).toBeGreaterThan(0);
    expect(stream.locked).toBe(false);
  });

  it('retains sniffed text bytes and response source positions without a synthetic prefix', async () => {
    const text = 'first line\nsecond';
    const { navigable, params, load } = await fixture('text/plain', utf8Encode(text));
    const document = load();
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    await expect.poll(() => document.readyState).toBe('complete');
    const node = document.querySelector('pre')!.firstChild!;
    expect(node.textContent).toBe(text);
    expect(getSourceCodeLocation(node)).toMatchObject({ startLine: 1, startCol: 1, startOffset: 0 });
  });

  it.each(['\n', '\r\n', 'a😀b\r\nc\0d', '\t x\nlast'])('preserves text and source locations with every byte split (%j)', async (text) => {
    const { navigable, params, stream, load } = await fixture('text/plain;charset=utf-8');
    const document = load();
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    for (const byte of utf8Encode(text)) stream.enqueueChunk(Uint8Array.of(byte));
    stream.close();
    await expect.poll(() => document.readyState).toBe('complete');
    const node = document.querySelector('pre')!.firstChild!;
    expect(node.textContent).toBe(text.replaceAll('\r\n', '\n').replaceAll('\0', '\ufffd'));
    expect(getSourceCodeLocation(node)).toMatchObject({ startLine: 1, startCol: 1, startOffset: 0, endOffset: text.length });
  });

  it.each(['abort', 'body failure'] as const)('stops text input without completing load after %s', async (cause) => {
    const { navigable, params, stream, resource, load } = await fixture('text/plain;charset=utf-8');
    const document = load();
    const finish = vi.spyOn(document, 'finishLoading');
    const cancel = vi.spyOn(resource, 'cancel');
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    stream.enqueueChunk(utf8Encode('partial'));
    await expect.poll(() => document.querySelector('pre')?.textContent).toBe('partial');
    if (cause === 'abort') document.env.queueTask('network', () => { document.abort(); });
    else stream.error(new Error('response body failed'));
    await expect.poll(() => document.activeParserWasAborted).toBe(true);
    expect(document.parser).toBeNull();
    expect(document.querySelector('pre')?.textContent).toBe('partial');
    expect(cancel).toHaveBeenCalledOnce();
    expect(finish).not.toHaveBeenCalled();
  });

  it('loads a real Fetch response through text dispatch and retains navigation completion timing', async () => {
    const text = '\n<script>literal</script>&amp; café';
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/plain;charset=utf-8' }).end(text);
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    cleanup.push(() => env.userAgent.httpTransport.close());
    const navigable = env.realm.getAssociatedDocument().getNodeNavigable()!;
    const request = new FetchRequest(env.parseURL(`${origin}/text`)!, env);
    request.client = env;
    request.mode = 'navigate';
    request.destination = 'document';
    request.redirectMode = 'manual';
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
            const document = navigable.loadDocument(params, new SourceSnapshotParams(null), null, resource)!;
            navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
            return document;
          }, undefined, internalType<DocumentImpl>()).observe(loading.resolve, loading.reject);
        } catch (error) { loading.reject(error); }
      },
    }, env.userAgent.sandbox);
    const document = await loading.promise;
    await expect.poll(() => document.readyState).toBe('complete');
    expect(document.querySelector('pre')?.textContent).toBe(text);
    expect(document.URL).toBe(`${origin}/text`);
    expect(document.contentType).toBe('text/plain');
    expect(document.querySelector('script')).toBeNull();
    const window = document.env.realm.globalObject as Window;
    const timing = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    expect(timing.responseEnd).toBeGreaterThan(0);
    expect(timing.loadEventEnd).toBeGreaterThanOrEqual(timing.responseEnd);
    expect(timing.encodedBodySize).toBe(utf8Encode(text).length);
    expect(timing.duration).toBe(timing.loadEventEnd);
  });
});

async function fixture(contentType: string, bytes?: Uint8Array) {
  const browser = new Browlet({ route: () => '' });
  const env = getRelevantRealm(browser.window).env;
  const navigable = env.realm.getAssociatedDocument().getNodeNavigable()!;
  const response = new FetchResponse();
  response.urlList = [env.parseURL('https://example.test/source')!];
  response.headerList.append('Content-Type', contentType);
  response.body = bytes === undefined
    ? new FetchBody(ReadableStreamImpl.createDefault(undefined, undefined, 0, () => 1, env.userAgent.sandbox), env.userAgent.sandbox)
    : FetchBody.fromBytes(bytes, env.userAgent.sandbox);
  const resource = new ResourceReader(response, env.userAgent);
  await new Promise<void>((resolve, reject) => resource.determineMIMEType().observe(() => { resolve(); }, reject));
  const params = navigable.createNavigationParams(response);
  return {
    browser, env, navigable, response, params, resource, stream: response.body.stream,
    load: () => navigable.loadDocument(params, new SourceSnapshotParams(null), null, resource)!,
  };
}
