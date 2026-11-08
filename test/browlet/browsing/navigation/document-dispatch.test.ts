import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { NavigationParams } from '../../../../src/browlet/browsing/navigation/params';
import { DocumentState, SourceSnapshotParams } from '../../../../src/browlet/browsing/navigation/state/index';
import { SandboxingFlagSet } from '../../../../src/browlet/browsing/policy/index';
import { ResourceReader } from '../../../../src/browlet/loader/resource-reader';
import { FetchBody, FetchResponse } from '../../../../src/fetch/index';
import { getMIMETypeEssence } from '../../../../src/mime/index';
import { ReadableStreamImpl } from '../../../../src/streams/index';
import { createOpaqueOrigin, parseURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';

afterEach(() => { vi.restoreAllMocks(); });

describe('navigation Document dispatch', () => {
  it.each([
    ['text/html; charset=utf-8', 'loadHTMLDocument'],
    ['application/xml', 'loadXMLDocument'], ['text/xml', 'loadXMLDocument'], ['application/atom+xml', 'loadXMLDocument'],
    ['text/javascript', 'loadTextDocument'], ['application/x-javascript', 'loadTextDocument'],
    ['application/json', 'loadTextDocument'], ['text/json', 'loadTextDocument'], ['application/example+json', 'loadTextDocument'],
    ['text/css', 'loadTextDocument'], ['text/plain', 'loadTextDocument'], ['text/vtt', 'loadTextDocument'],
    ['multipart/x-mixed-replace; boundary=part', 'loadMultipartDocument'],
  ] as const)('dispatches %s through %s with the prepared reader', async (contentType, method) => {
    const { navigable, params, source, origin, resource, dispatch } = fixture(contentType);
    const document = navigable.activeDocument!;
    const load = vi.spyOn(navigable, method).mockReturnValue(document);
    await resource.determineMIMEType();
    expect(dispatch()).toBe(document);
    const args = method === 'loadHTMLDocument' ? [params, undefined, resource]
      : method === 'loadMultipartDocument' ? [params, source, origin, resource] : [params, resource.mimeType, resource];
    expect(load).toHaveBeenCalledExactlyOnceWith(...args);
  });

  it('rejects dispatch before MIME preparation', () => {
    const { dispatch } = fixture('text/html');
    expect(dispatch).toThrow('Determine the MIME type before selecting a document loader');
  });

  it('hands sniffed HTML bytes and the remaining stream to the selected loader unchanged', async () => {
    const { navigable, params, userAgent } = fixture();
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 0, () => 1, userAgent.sandbox);
    params.response.body = new FetchBody(stream, userAgent.sandbox);
    const resource = new ResourceReader(params.response, userAgent);
    const source = new SourceSnapshotParams(null);
    const prefix = new Uint8Array(1450).fill(32);
    prefix.set(new TextEncoder().encode('<!doctype html>'));
    const remaining = new TextEncoder().encode('<p>not lost</p>');
    const sniffed = resource.determineMIMEType();
    stream.enqueueChunk(prefix);
    await sniffed;
    expect(getMIMETypeEssence(resource.mimeType)).toBe('text/html');
    const load = vi.spyOn(navigable, 'loadHTMLDocument').mockReturnValue(navigable.activeDocument!);
    navigable.loadDocument(params, source, null, resource);
    expect(load).toHaveBeenCalledExactlyOnceWith(params, undefined, resource);
    await expect(resource.read()).resolves.toEqual(prefix);
    const rest = resource.read();
    stream.enqueueChunk(remaining);
    stream.close();
    await expect(rest).resolves.toEqual(remaining);
    await expect(resource.read()).resolves.toBeNull();
  });

  it.each(['application/atom+xml', 'application/example+json'])('uses configured inline handling for %s', async (contentType) => {
    const { navigable, userAgent, resource, params, dispatch } = fixture(contentType);
    await resource.determineMIMEType();
    userAgent.documentTypeHandlers.set(getMIMETypeEssence(resource.mimeType), 'inline');
    const xml = vi.spyOn(navigable, 'loadXMLDocument');
    const text = vi.spyOn(navigable, 'loadTextDocument');
    const inline = vi.spyOn(navigable, 'createDocumentForInlineContent').mockReturnValue(navigable.activeDocument!);
    expect(dispatch()).toBe(navigable.activeDocument);
    expect(xml).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(inline).toHaveBeenCalledExactlyOnceWith(params.id, params.navigationTimingType, params.userInvolvement, resource);
  });

  it.each(['image/png', 'audio/ogg', 'video/mp4', 'application/ogg', 'image/svg+xml'])('checks actual media support for %s', async (contentType) => {
    const { navigable, userAgent, resource, params, dispatch } = fixture(contentType);
    await resource.determineMIMEType();
    if (contentType === 'image/svg+xml') userAgent.documentTypeHandlers.set(contentType, 'inline');
    const supports = vi.spyOn(userAgent, 'supportsMIMEType').mockReturnValue(true);
    const media = vi.spyOn(navigable, 'loadMediaDocument').mockReturnValue(navigable.activeDocument!);
    expect(dispatch()).toBe(navigable.activeDocument);
    expect(supports).toHaveBeenCalledWith(resource.mimeType);
    expect(media).toHaveBeenCalledExactlyOnceWith(params, resource.mimeType, resource);
  });

  it('does not claim an unsupported media type can be rendered', async () => {
    const { navigable, userAgent, resource, dispatch } = fixture('video/x-unknown');
    await resource.determineMIMEType();
    const media = vi.spyOn(navigable, 'loadMediaDocument');
    const fallback = vi.spyOn(userAgent, 'shouldDisplayUnsupportedResourceInline');
    expect(dispatch).toThrow('Unsupported navigation resource handling is not implemented');
    expect(media).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledExactlyOnceWith(resource.mimeType);
  });

  it.each(['application/pdf', 'text/pdf'])('uses PDF viewer support for %s', async (contentType) => {
    const { navigable, userAgent, params, resource, dispatch } = fixture(contentType);
    await resource.determineMIMEType();
    const inline = vi.spyOn(navigable, 'createDocumentForInlineContent').mockReturnValue(navigable.activeDocument!);
    expect(userAgent.pdfViewerSupported).toBe(false);
    expect(dispatch).toThrow('Unsupported navigation resource handling is not implemented');
    expect(inline).not.toHaveBeenCalled();
    userAgent.pdfViewerSupported = true;
    expect(dispatch()).toBe(navigable.activeDocument);
    expect(inline).toHaveBeenCalledExactlyOnceWith(params.id, params.navigationTimingType, params.userInvolvement, resource);
  });

  it.each(['text/html', 'application/example+json'])('lets an external configuration override built-in handling of %s', async (contentType) => {
    const { navigable, userAgent, params, source, origin, resource, dispatch } = fixture(contentType);
    await resource.determineMIMEType();
    userAgent.documentTypeHandlers.set(getMIMETypeEssence(resource.mimeType), 'external');
    const html = vi.spyOn(navigable, 'loadHTMLDocument');
    const fallback = vi.spyOn(userAgent, 'shouldDisplayUnsupportedResourceInline');
    const handoff = vi.spyOn(userAgent, 'requestExternalSoftwareHandoff').mockImplementation(() => {});
    expect(dispatch()).toBeNull();
    expect(html).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
    expect(handoff).toHaveBeenCalledExactlyOnceWith(params.response, navigable, source.hasTransientActivation, origin, resource);
  });

  it.each([false, true])('routes an unmatched type through the chosen fallback (inline: %s)', async (inline) => {
    const { navigable, userAgent, params, resource, dispatch } = fixture('application/x-unknown');
    await resource.determineMIMEType();
    vi.spyOn(userAgent, 'shouldDisplayUnsupportedResourceInline').mockReturnValue(inline);
    const render = vi.spyOn(navigable, 'createDocumentForInlineContent').mockReturnValue(navigable.activeDocument!);
    const handoff = vi.spyOn(userAgent, 'requestExternalSoftwareHandoff').mockImplementation(() => {});
    expect(dispatch()).toBe(inline ? navigable.activeDocument : null);
    expect(render).toHaveBeenCalledTimes(inline ? 1 : 0);
    expect(handoff).toHaveBeenCalledTimes(inline ? 0 : 1);
    if (!inline) expect(handoff.mock.calls[0]![0]).toBe(params.response);
  });

  it('retains the null-initiator dependency only at an external handoff', async () => {
    const { navigable, userAgent, params, source, resource } = fixture('text/html');
    await resource.determineMIMEType();
    const html = vi.spyOn(navigable, 'loadHTMLDocument').mockReturnValue(navigable.activeDocument!);
    expect(navigable.loadDocument(params, source, null, resource)).toBe(navigable.activeDocument);
    expect(html).toHaveBeenCalledOnce();
    userAgent.documentTypeHandlers.set('text/html', 'external');
    const handoff = vi.spyOn(userAgent, 'requestExternalSoftwareHandoff');
    expect(() => navigable.loadDocument(params, source, null, resource))
      .toThrow('External resource handoff without an initiator origin is not implemented');
    expect(handoff).not.toHaveBeenCalled();
  });

  it.each([
    ['text/html', 'HTML document loading requires response-reader setup and parser script preparation'],
    ['application/xml', 'XML document loading is not implemented'],
    ['text/plain', 'Text document loading is not implemented'],
    ['multipart/x-mixed-replace', 'Multipart document loading is not implemented'],
    ['image/png', 'Media document loading is not implemented'],
  ] as const)('keeps the actual loader explicit for %s', async (contentType, message) => {
    const { userAgent, resource, dispatch } = fixture(contentType);
    await resource.determineMIMEType();
    vi.spyOn(userAgent, 'supportsMIMEType').mockReturnValue(true);
    expect(dispatch).toThrow(message);
  });
});

describe('population MIME preparation', () => {
  it.each(['ready', 'failed'] as const)('notifies the waiting operation when teardown discards the %s MIME continuation', async (outcome) => {
    const { navigable, params, source, userAgent } = fixture();
    navigable.ongoingNavigation = 'dispatch';
    const document = navigable.activeDocument!;
    const env = document.env;
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 0, () => 1, userAgent.sandbox);
    params.response.body = new FetchBody(stream, userAgent.sandbox);
    const entry = env.createSessionHistoryEntry(params.url, new DocumentState());
    const load = vi.spyOn(navigable, 'loadDocument');
    const complete = vi.fn();
    const failed = vi.fn();
    const queue = vi.spyOn(env, 'queueTask');
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, navigable.snapshotTargetParams(), 'none', {
      navigationId: 'dispatch', navigationParams: params, completionSteps: complete, failureSteps: failed,
    });
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    env.queueTask('navigation-and-traversal', () => { document.destroy(); });
    if (outcome === 'failed') stream.error(new Error('response body failed'));
    else stream.close();
    await expect.poll(() => queue.mock.calls.length).toBe(3);
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(document.browsingContext).toBeNull();
    expect(failed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'History population task was discarded' }));
    expect(complete).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('delivers a body-read failure to the waiting operation without a duplicate task error', async () => {
    const { navigable, params, source, userAgent } = fixture();
    navigable.ongoingNavigation = 'dispatch';
    const env = navigable.activeWindow!.env;
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 0, () => 1, userAgent.sandbox);
    params.response.body = new FetchBody(stream, userAgent.sandbox);
    const entry = env.createSessionHistoryEntry(params.url, new DocumentState());
    const load = vi.spyOn(navigable, 'loadDocument');
    const complete = vi.fn();
    const failed = vi.fn();
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, navigable.snapshotTargetParams(), 'none', {
      navigationId: 'dispatch', navigationParams: params, completionSteps: complete, failureSteps: failed,
    });
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    const queued = Promise.withResolvers<void>();
    const queueTask = env.queueTask.bind(env);
    vi.spyOn(env, 'queueTask').mockImplementationOnce((...args) => {
      const task = queueTask(...args);
      queued.resolve();
      return task;
    });
    const failure = new Error('response body failed');
    stream.error(failure);
    await queued.promise;
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(failed).toHaveBeenCalledExactlyOnceWith(failure);
    expect(complete).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps late cancellation cleanup separate from completed population (discard: %s)', async (discard) => {
    const { navigable, params, source, userAgent } = fixture();
    navigable.ongoingNavigation = 'dispatch';
    const env = navigable.activeWindow!.env;
    const failure = new Error('response cancellation failed');
    const stream = ReadableStreamImpl.createDefault(undefined, () => { throw failure; }, 0, () => 1, userAgent.sandbox);
    params.response.body = new FetchBody(stream, userAgent.sandbox);
    const entry = env.createSessionHistoryEntry(params.url, new DocumentState());
    const complete = vi.fn();
    const failed = vi.fn();
    const queue = vi.spyOn(env, 'queueTask');
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, navigable.snapshotTargetParams(), 'none', {
      navigationId: 'dispatch', navigationParams: params, completionSteps: complete, failureSteps: failed,
    });
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    stream.enqueueChunk(new Uint8Array(1450).fill(32));
    await expect.poll(() => queue.mock.calls.length).toBe(2);
    navigable.ongoingNavigation = 'replacement';
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    await expect.poll(() => queue.mock.calls.length).toBe(3);
    if (discard) {
      env.responsibleEventLoop.removeTasksForDocument(navigable.activeDocument!);
      expect(env.responsibleEventLoop.runTaskTurn()).toBe(false);
    } else {
      expect(() => env.responsibleEventLoop.runTaskTurn()).toThrow(failure);
    }
    expect(failed).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledOnce();
  });

  it.each([
    { owner: null, next: null }, { owner: null, next: 'replacement' },
    { owner: 'traversal', next: 'traversal' }, { owner: 'traversal', next: 'replacement' },
    { owner: 'traversal', next: null },
  ])('resumes on the destination task and rechecks ownership ($owner → $next)', async ({ owner, next }) => {
    const superseded = owner !== next;
    const { navigable, params, source, userAgent } = fixture();
    params.id = null;
    navigable.ongoingNavigation = owner;
    const env = navigable.activeWindow!.env;
    const canceled = vi.fn();
    const stream = ReadableStreamImpl.createDefault(undefined, canceled, 0, () => 1, userAgent.sandbox);
    params.response.body = new FetchBody(stream, userAgent.sandbox);
    const entry = env.createSessionHistoryEntry(params.url, new DocumentState());
    entry.documentState.requestReferrer = null;
    const loaded = env.createDocument();
    const load = vi.spyOn(navigable, 'loadDocument').mockImplementation(() => {
      expect(env.responsibleEventLoop.currentlyRunningTask).not.toBeNull();
      return loaded;
    });
    const complete = vi.fn(() => { expect(env.responsibleEventLoop.currentlyRunningTask).not.toBeNull(); });
    const queue = vi.spyOn(env, 'queueTask');
    navigable.populateHistoryEntryDocument(entry, 'navigate', source, navigable.snapshotTargetParams(), 'none', {
      navigationParams: params, completionSteps: complete,
    });
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(load).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    const bytes = new Uint8Array(1450).fill(32);
    bytes.set(new TextEncoder().encode('<!doctype html>'));
    stream.enqueueChunk(bytes);
    await expect.poll(() => queue.mock.calls.length).toBe(2);
    navigable.ongoingNavigation = next;
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledTimes(superseded ? 0 : 1);
    expect(entry.document).toBe(superseded ? null : loaded);
    if (superseded) {
      await expect.poll(() => canceled.mock.calls.length).toBe(1);
    } else {
      expect(canceled).not.toHaveBeenCalled();
      const reader = load.mock.calls[0]![3];
      expect(getMIMETypeEssence(reader.mimeType)).toBe('text/html');
      await expect(reader.read()).resolves.toEqual(bytes);
      stream.close();
      await expect(reader.read()).resolves.toBeNull();
    }
  });
});

function fixture(contentType?: string) {
  const userAgent = createManualUserAgent();
  const navigable = TopLevelTraversable.create(userAgent, null, 'dispatch');
  const response = new FetchResponse();
  response.urlList = [parseURL('https://example.test/document').url!];
  if (contentType !== undefined) response.headerList.append('Content-Type', contentType);
  const params = new NavigationParams(response, new SandboxingFlagSet(), 0);
  params.id = 'dispatch';
  params.navigationTimingType = 'back_forward';
  params.userInvolvement = 'activation';
  const source = new SourceSnapshotParams(null);
  const origin = createOpaqueOrigin();
  const resource = new ResourceReader(response, userAgent);
  const dispatch = () => navigable.loadDocument(params, source, origin, resource);
  return { userAgent, navigable, params, source, origin, resource, dispatch };
}
