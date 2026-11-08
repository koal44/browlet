import { createServer, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UserAgent } from '../../../src/browlet/user-agent';
import { Browlet } from '../../../src/browlet/browlet';
import { DocumentState, SourceSnapshotParams } from '../../../src/browlet/browsing/navigation/state/index';
import { BrowsingContext, Navigable, NavigationParams } from '../../../src/browlet/browsing/navigation/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/iframe';
import { MultipartResourceReader } from '../../../src/browlet/loader/multipart-reader';
import { ResourceReader } from '../../../src/browlet/loader/resource-reader';
import type { Window } from '../../../src/browlet/platform';
import { FetchBody, FetchResponse } from '../../../src/fetch/index';
import { fetch } from '../../../src/fetch/fetch';
import { FetchRequest } from '../../../src/fetch/request';
import { ReadableStreamImpl } from '../../../src/streams/index';
import { utf8Decode, utf8Encode } from '../../../src/encoding/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { closeServer, listen } from './http-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('multipart Document loading', () => {
  it('populates a history entry from real Fetch and fires load before the outer response ends', async () => {
    let transport: ServerResponse | undefined;
    const server = createServer((_request, response) => {
      transport = response;
      response.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=part' });
      response.write(`--part\r\nContent-Type: text/html;charset=utf-8\r\n\r\n<!doctype html><p>network</p>${' '.repeat(1500)}`);
    });
    const origin = await listen(server);
    cleanup.push(() => closeServer(server));
    const browser = new Browlet({ route: () => '' });
    const env = getRelevantRealm(browser.window).env;
    cleanup.push(() => env.userAgent.httpTransport.close());
    const navigable = env.realm.getAssociatedDocument().getNodeNavigable()!;
    const request = new FetchRequest(env.parseURL(`${origin}/parts`)!, env);
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
          const state = new DocumentState();
          state.initiatorOrigin = env.origin;
          const entry = env.createSessionHistoryEntry(params.url, state);
          navigable.populateHistoryEntryDocument(entry, 'navigate', new SourceSnapshotParams(null), navigable.snapshotTargetParams(), 'browser UI', {
            navigationParams: params,
            completionSteps() {
              const document = entry.document;
              if (document === null) { loading.reject(new Error('Expected the first multipart Document')); return; }
              navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', entry);
              loading.resolve(document);
            },
            failureSteps: loading.reject,
          });
        } catch (error) { loading.reject(error); }
      },
    }, env.userAgent.sandbox);
    const document = await loading.promise;
    await expect.poll(() => document.querySelector('p')?.textContent).toBe('network');
    expect(document.readyState).toBe('loading');
    const loaded = vi.fn();
    (document.env.realm.globalObject as Window).addEventListener('load', loaded);
    transport!.write('\r\n--part--\r\n');
    await expect.poll(() => loaded.mock.calls.length).toBe(1);
    expect(document.readyState).toBe('complete');
    expect(navigable.activeDocument).toBe(document);
    expect(transport!.writableEnded).toBe(false);
    transport!.end();
    await expect.poll(() => request.done).toBe(true);
  });

  it('loads the first part, finishes it at the boundary, and hands the next response to replacement navigation', async () => {
    const { navigable, params, stream, load } = await fixture();
    const navigate = vi.spyOn(navigable, 'navigate').mockImplementation(() => {});
    const loading = load();
    stream.enqueueChunk(utf8Encode('--part\r\nContent-Type: text/html;charset=utf-8\r\n\r\n<p id="first">first</p>'));
    const document = (await loading)!;
    expect(document.contentType).toBe('text/html');
    expect(document.URL).toBe('https://example.test/multipart');
    const window = document.env.realm.globalObject as Window;
    const loaded = vi.fn();
    window.addEventListener('load', loaded);
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    await expect.poll(() => document.querySelector('#first')?.textContent).toBe('first');
    expect(document.readyState).toBe('loading');
    expect(navigate).not.toHaveBeenCalled();

    // The next part's headers have not arrived, and the HTTP body remains open.
    stream.enqueueChunk(utf8Encode('\r\n--part\r\n'));
    await expect.poll(() => loaded.mock.calls.length).toBe(1);
    expect(document.readyState).toBe('complete');
    expect(stream.state.state).toBe('readable');
    expect(navigate).not.toHaveBeenCalled();

    stream.enqueueChunk(utf8Encode('Content-Type: text/plain;charset=utf-8\r\n\r\nsecond\r\n--part--\r\n'));
    await expect.poll(() => navigate.mock.calls.length).toBe(1);
    const [url, source, options, env] = navigate.mock.calls[0]!;
    expect(url).toBe(params.url); // A supplied response has no request URL.
    expect(source).toBe(navigable.activeDocument);
    expect(source).toBe(document);
    expect(env).toBe(document.env);
    expect(options?.historyHandling).toBe('replace');
    expect(options?.response).not.toBe(params.response);
    expect(options?.response?.headerList.get('Content-Type')).toBe('text/plain;charset=utf-8');
    expect(await readBody(options!.response!, env!.userAgent)).toBe('second');
    stream.close();
    await expect.poll(() => stream.locked).toBe(false);
    expect(document.querySelector('#first')?.textContent).toBe('first');
  });

  it('uses the RFC text/plain default and preserves a first part split across transport chunks', async () => {
    const { navigable, params, stream, load } = await fixture();
    const loading = load();
    for (const byte of utf8Encode('--part\r\n\r\n<b>literal</b>')) stream.enqueueChunk(Uint8Array.of(byte));
    const document = (await loading)!;
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    await expect.poll(() => document.querySelector('pre')?.textContent).toBe('<b>literal</b>');
    expect(document.querySelector('b')).toBeNull();
    expect(document.contentType).toBe('text/plain');
    stream.enqueueChunk(utf8Encode('\r\n--part--\r\n'));
    stream.close();
    await expect.poll(() => document.readyState).toBe('complete');
  });

  it('cancels a superseded first-part admission instead of constructing its Document', async () => {
    const { navigable, stream, canceled, load } = await fixture();
    navigable.ongoingNavigation = 'multipart';
    const loading = load();
    navigable.ongoingNavigation = 'replacement';
    await expect(loading).rejects.toThrow('Multipart navigation was superseded');
    await expect.poll(() => canceled.mock.calls.length).toBe(1);
    expect(navigable.activeDocument?.URL).toBe('about:blank');
    expect(stream.locked).toBe(false);
  });

  it('does not adopt a reentrant navigation as the next part replacement', async () => {
    const { navigable, params, stream, canceled, load } = await fixture();
    const loading = load();
    stream.enqueueChunk(utf8Encode('--part\r\nContent-Type: text/html\r\n\r\n<p>first</p>'));
    const document = (await loading)!;
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    await expect.poll(() => document.querySelector('p')?.textContent).toBe('first');
    vi.spyOn(navigable, 'navigate').mockImplementation(() => {
      navigable.ongoingNavigation = 'next part';
      navigable.ongoingNavigation = 'author replacement';
    });
    stream.enqueueChunk(utf8Encode('\r\n--part\r\nContent-Type: text/html\r\n\r\nsecond'));
    await expect.poll(() => canceled.mock.calls.length).toBe(1);
    expect(navigable.ongoingNavigation).toBe('author replacement');
  });

  it('aborts an interrupted part without reporting a transport failure as an internal implementation error', async () => {
    const { env, navigable, params, stream, load } = await fixture();
    const errors: unknown[] = [];
    const runInParallel = env.userAgent.runInParallel.bind(env.userAgent);
    vi.spyOn(env.userAgent, 'runInParallel').mockImplementation((steps) => runInParallel(() => {
      try { steps(); } catch (error) { errors.push(error); }
    }));
    const loading = load();
    stream.enqueueChunk(utf8Encode('--part\r\nContent-Type: text/html\r\n\r\n<p>partial</p>'));
    const document = (await loading)!;
    const finish = vi.spyOn(document, 'finishLoading');
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    await expect.poll(() => document.querySelector('p')?.textContent).toBe('partial');
    stream.error(new Error('transport failed'));
    await expect.poll(() => document.activeParserWasAborted).toBe(true);
    expect(errors).toEqual([]);
    expect(finish).not.toHaveBeenCalled();
  });

  it('copies navigation inputs for a part without replacing the outer response or losing the start time', async () => {
    const { params, stream } = await fixture();
    const response = params.response.copy(null);
    const copy = params.withResponse(response);
    expect(copy).not.toBe(params);
    expect(copy.response).toBe(response);
    expect(params.response).not.toBe(response);
    expect(copy.startTime).toBe(params.startTime);
    expect(copy.policyContainer).toBe(params.policyContainer);
    expect(copy.origin).toBe(params.origin);
    expect(copy.id).toBe(params.id);
    expect(copy.finalSandboxingFlagSet).toBe(params.finalSandboxingFlagSet);
    stream.close();
  });
});

describe('multipart CSP', () => {
  it('retains outer and part CSP as independent policies before the first Document is created', async () => {
    const { params, stream, load } = await fixture([
      ['Content-Security-Policy', 'img-src https://images.test'],
      ['Referrer-Policy', 'no-referrer'],
    ]);
    const loading = load();
    stream.enqueueChunk(utf8Encode('--part\r\nContent-Type: text/html\r\nContent-Security-Policy: sandbox allow-scripts; connect-src \'none\'\r\nContent-Security-Policy-Report-Only: script-src \'none\'\r\n\r\n<p>protected</p>\r\n--part--\r\n'));
    stream.close();
    const document = (await loading)!;
    expect(document.policyContainer.cspList!.policies.map((policy) => [policy.serialized, policy.disposition])).toEqual([
      ['img-src https://images.test', 'enforce'],
      ["sandbox allow-scripts; connect-src 'none'", 'enforce'],
      ["script-src 'none'", 'report'],
    ]);
    expect(document.policyContainer.referrerPolicy).toBe('no-referrer');
    expect(document.activeSandboxingFlagSet.has('sandboxed-origin')).toBe(true);
    expect(document.activeSandboxingFlagSet.has('sandboxed-scripts')).toBe(false);
    expect(document.origin.kind).toBe('opaque');
    expect(document.env.origin).toBe(document.origin);
    expect(params.origin.kind).toBe('tuple');
    expect(params.policyContainer.cspList!.policies).toHaveLength(1);
  });

  it('keeps earlier restrictions independent without leaking later policies into earlier parts', async () => {
    const { parts, stream, env, navigable } = await fixture([
      ['Content-Security-Policy', "img-src 'self'"],
      ['Content-Security-Policy-Report-Only', "connect-src 'none'"],
    ]);
    const first = parts.readPart();
    stream.enqueueChunk(utf8Encode(
      '--part\r\nContent-Security-Policy: img-src https://images.test; sandbox allow-scripts\r\n\r\none\r\n' +
      "--part\r\nContent-Security-Policy:\r\nContent-Security-Policy: script-src 'none'\r\n\r\ntwo\r\n--part--\r\n",
    ));
    stream.close();
    const a = (await first)!;
    const b = (await parts.readPart())!;
    const createParams = (response: FetchResponse) => NavigationParams.fromSuppliedResponse(
      response, navigable, navigable.activeDocument, navigable.snapshotTargetParams(), new DocumentState(),
      'multipart-policy', 'none', env,
    );
    const firstParams = createParams(a);
    const nextParams = createParams(b);
    expect(firstParams.policyContainer.cspList!.policies.map((policy) => policy.serialized)).toEqual([
      "img-src 'self'", 'img-src https://images.test; sandbox allow-scripts', "connect-src 'none'",
    ]);
    expect(nextParams.policyContainer.cspList!.policies.map((policy) => policy.serialized)).toEqual([
      "img-src 'self'", 'img-src https://images.test; sandbox allow-scripts', "script-src 'none'", "connect-src 'none'",
    ]);
    expect(nextParams.origin.kind).toBe('opaque');
    expect(nextParams.finalSandboxingFlagSet.has('sandboxed-origin')).toBe(true);
    expect(nextParams.policyContainer.cspList!.policies.at(-1)!.disposition).toBe('report');
    // Neither image origin satisfies both independent policies. Combining directive
    // text would discard the second img-src and incorrectly admit the first URL.
    for (const url of ['https://example.test/image', 'https://images.test/image']) {
      const request = new FetchRequest(env.parseURL(url)!, env);
      request.client = env;
      request.destination = 'image';
      expect(nextParams.policyContainer.cspList!.isRequestBlocked(request)).toBe(true);
    }
    expect(await readBody(a, env.userAgent)).toBe('one');
    expect(await readBody(b, env.userAgent)).toBe('two');
  });

  it('preserves outer sandbox restrictions and ignores report-only sandbox', async () => {
    const { params, stream, load } = await fixture([['Content-Security-Policy', 'sandbox allow-same-origin']]);
    const loading = load();
    stream.enqueueChunk(utf8Encode(
      '--part\r\nContent-Type: text/html\r\nContent-Security-Policy: sandbox allow-scripts allow-same-origin\r\n' +
      'Content-Security-Policy-Report-Only: sandbox\r\n\r\n<p>protected</p>\r\n--part--\r\n',
    ));
    stream.close();
    const document = (await loading)!;
    expect(document.activeSandboxingFlagSet.has('sandboxed-scripts')).toBe(true);
    expect(document.activeSandboxingFlagSet.has('sandboxed-origin')).toBe(false);
    expect(document.origin).toBe(params.origin);
    expect(document.env.origin).toBe(params.origin);
  });

  it.each(['enforce', 'report'] as const)('checks first-part frame-ancestors before admission (%s)', async (disposition) => {
    const { env, navigable, stream, load } = await fixture([], true);
    const createDocument = vi.spyOn(navigable, 'createAndInitializeDocument');
    const errorPage = vi.spyOn(navigable, 'createDocumentForInlineContent');
    const reporting = vi.spyOn(env.userAgent, 'queueReportingTask').mockImplementation(() => {});
    const loading = load();
    const header = disposition === 'report' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
    stream.enqueueChunk(utf8Encode(`--part\r\nContent-Type: text/html\r\n${header}: frame-ancestors 'none'; report-uri /report\r\n\r\n<p>child</p>\r\n--part--\r\n`));
    stream.close();
    if (disposition === 'enforce') {
      // Blocked admission creates an isolated error Document, then reaches the explicit renderer.
      await expect(loading).rejects.toThrow('Inline user-agent Document rendering is not implemented');
      expect(errorPage).toHaveBeenCalledOnce();
      expect(createDocument).toHaveBeenCalledOnce();
      const errorParams = createDocument.mock.calls[0]![2];
      expect(errorParams.policyContainer.cspList?.policies ?? []).toEqual([]);
      expect(errorParams.response.body).toBeNull();
      expect(errorPage).toHaveBeenCalledExactlyOnceWith(null, 'navigate', 'browser UI', errorParams.url);
    } else {
      expect((await loading)!.contentType).toBe('text/html');
      expect(createDocument).toHaveBeenCalledOnce();
      expect(errorPage).not.toHaveBeenCalled();
    }
    expect(reporting).toHaveBeenCalledOnce();
  });

  it('does not let a new part sandbox bypass an already prepared COOP decision', async () => {
    const { params, stream, load } = await fixture();
    params.openerPolicy.value = 'same-origin';
    params.coopEnforcementResult = {
      url: params.url, origin: params.origin, openerPolicy: params.openerPolicy,
      needsBrowsingContextGroupSwitch: false, wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
      currentContextIsNavigationSource: false,
    };
    const loading = load();
    stream.enqueueChunk(utf8Encode('--part\r\nContent-Type: text/html\r\nContent-Security-Policy: sandbox allow-scripts\r\n\r\n<p>blocked</p>\r\n--part--\r\n'));
    stream.close();
    await expect(loading).rejects.toThrow('Sandboxed COOP navigation requires network-error processing');
  });

  it('retains inherited local-URL policy and leaves added part policy explicitly unfinished', async () => {
    const { parts, params, response, stream, env } = await fixture([['Content-Security-Policy', "script-src 'none'"]]);
    response.urlList = [env.parseURL('blob:https://example.test/resource')!];
    const copy = params.withMultipartResponse(response.copy(null));
    expect(copy.policyContainer).toBe(params.policyContainer);
    const first = parts.readPart();
    stream.enqueueChunk(utf8Encode('--part\r\nContent-Security-Policy: img-src *\r\n\r\nbody\r\n--part--\r\n'));
    await expect(first).rejects.toThrow('Local-URL multipart part CSP inheritance is not implemented');
  });
});

describe('multipart response bodies', () => {

  it('does not read further transport chunks while the current body has no consumer demand', async () => {
    const { parts, stream, resource, env } = await fixture();
    const read = vi.spyOn(resource, 'read');
    const first = parts.readPart();
    stream.enqueueChunk(utf8Encode('--part\r\nContent-Type: text/html\r\n\r\n<p>'));
    const response = (await first)!;
    const calls = read.mock.calls.length;
    const next = parts.readPart();
    let receivedNext = false;
    next.observe(() => { receivedNext = true; }, () => {});
    stream.enqueueChunk(utf8Encode('body</p>\r\n--part--\r\n'));
    stream.close();
    await new Promise<void>((resolve) => env.userAgent.sandbox.queueTask('network', resolve));
    expect(read).toHaveBeenCalledTimes(calls);
    expect(receivedNext).toBe(false);
    expect(await readBody(response, env.userAgent)).toBe('<p>body</p>');
    await expect(next).resolves.toBeNull();
  });

  it('preserves individual response metadata and independently closes multiple parts in one chunk', async () => {
    const { parts, stream, response, env } = await fixture();
    response.headerList.append('Content-Length', '9000');
    response.headerList.append('Content-Encoding', 'gzip');
    const first = parts.readPart();
    stream.enqueueChunk(utf8Encode('--part\r\nContent-Type: text/plain\r\nContent-Length: 3\r\n\r\none\r\n--part\r\nContent-Type: text/html\r\n\r\n<p>two</p>\r\n--part--\r\n'));
    stream.close();
    const a = (await first)!;
    const b = (await parts.readPart())!;
    expect(a.url).toEqual(response.url);
    expect(a.headerList.get('Content-Length')).toBe('3');
    expect(b.headerList.get('Content-Length')).toBeNull();
    expect(a.headerList.get('Content-Encoding')).toBeNull();
    expect(b.headerList.get('Content-Type')).toBe('text/html');
    expect(await readBody(a, env.userAgent)).toBe('one');
    expect(await readBody(b, env.userAgent)).toBe('<p>two</p>');
    expect(a.bodyInfo).toMatchObject({ encodedSize: 3, decodedSize: 3 });
    expect(b.bodyInfo).toMatchObject({ encodedSize: 10, decodedSize: 10 });
    await expect(parts.readPart()).resolves.toBeNull();
  });

  it('propagates source failure to the active body and the waiting next-part read', async () => {
    const { parts, stream, env } = await fixture();
    const first = parts.readPart();
    stream.enqueueChunk(utf8Encode('--part\r\nContent-Type: text/html\r\n\r\n<p>'));
    const response = (await first)!;
    const body = new ResourceReader(response, env.userAgent);
    await body.determineMIMEType();
    await expect(body.read()).resolves.toEqual(utf8Encode('<p>'));
    const next = parts.readPart();
    const rest = body.read();
    const failure = new Error('transport failed');
    const rejected = Promise.all([expect(rest).rejects.toBe(failure), expect(next).rejects.toBe(failure)]);
    stream.error(failure);
    await rejected;
  });

  it('propagates active-body cancellation to the outer response', async () => {
    const { parts, stream, canceled, env } = await fixture();
    const first = parts.readPart();
    stream.enqueueChunk(utf8Encode('--part\r\nContent-Type: text/html\r\n\r\n<p>'));
    const body = new ResourceReader((await first)!, env.userAgent);
    const reason = new Error('stop loading');
    const cancellation = body.cancel(reason);
    await expect.poll(() => canceled.mock.calls.length).toBe(1);
    // Require automatic completion across the nested readers' Promise queues.
    await cancellation;
    expect(canceled).toHaveBeenCalledExactlyOnceWith(reason);
    await expect(parts.readPart()).rejects.toBe(reason);
  });
});

async function fixture(outerHeaders: [string, string][] = [], embedded = false) {
  const browser = new Browlet({ route: () => '' });
  const env = getRelevantRealm(browser.window).env;
  cleanup.push(() => env.userAgent.httpTransport.close());
  let navigable = env.realm.getAssociatedDocument().getNodeNavigable()!;
  if (embedded) {
    const document = navigable.activeDocument!;
    const iframe = document.createElement('iframe') as HTMLIFrameElementImpl;
    const [, childDocument] = BrowsingContext.create(document, iframe, document.browsingContext!.group!);
    navigable = new Navigable(DocumentState.create(childDocument), navigable);
    iframe.contentNavigable = navigable;
    document.body!.appendChild(iframe);
  }
  const canceled = vi.fn();
  const stream = ReadableStreamImpl.createDefault(undefined, canceled, 0, () => 1, env.userAgent.sandbox);
  const response = new FetchResponse();
  response.urlList = [env.parseURL('https://example.test/multipart')!];
  response.headerList.append('Content-Type', 'multipart/x-mixed-replace; boundary=part');
  for (const [name, value] of outerHeaders) response.headerList.append(name, value);
  response.body = new FetchBody(stream, env.userAgent.sandbox);
  const resource = new ResourceReader(response, env.userAgent);
  // Fill MIME sniffing's prefix with legal preamble without waiting for its host deadline.
  stream.enqueueChunk(utf8Encode(`${'preamble '.repeat(190)}\r\n`));
  await resource.determineMIMEType();
  const params = navigable.createNavigationParams(response);
  return {
    env, navigable, params, resource, stream, response, canceled,
    parts: new MultipartResourceReader(resource, env.userAgent),
    load: () => navigable.loadDocument(params, new SourceSnapshotParams(null), null, resource),
  };
}

async function readBody(response: FetchResponse, userAgent: UserAgent): Promise<string> {
  const resource = new ResourceReader(response, userAgent);
  await resource.determineMIMEType();
  let text = '';
  for (let bytes = await resource.read(); bytes !== null; bytes = await resource.read()) text += utf8Decode(bytes);
  return text;
}
