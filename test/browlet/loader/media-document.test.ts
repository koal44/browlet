import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { SourceSnapshotParams } from '../../../src/browlet/browsing/navigation/state/index';
import { DocumentImpl, DocumentMode } from '../../../src/browlet/dom/nodes/document';
import { HTMLImageElementImpl, HTMLMediaElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/index';
import { ResourceReader } from '../../../src/browlet/loader/resource-reader';
import type { Window } from '../../../src/browlet/platform';
import { networkingTaskSource } from '../../../src/browlet/scripting/tasks';
import { UserAgent } from '../../../src/browlet/user-agent';
import { FetchBody, FetchResponse } from '../../../src/fetch/index';
import { HTML_NAMESPACE } from '../../../src/infra/index';
import { createManualUserAgent } from '../../support/browlet-agent';

afterEach(() => { vi.restoreAllMocks(); });

describe('media Document loading', () => {
  // SPEC_CLASH(media-document-host-element): HTML specifies audio with src; engines use video instead.
  it.each([
    ['image/png', 'img'], ['audio/ogg', 'audio'], ['video/webm', 'video'],
  ] as const)('builds the prescribed %s presentation and hands its response to %s', async (contentType, tag) => {
    const { navigable, params, response, resource, load } = await fixture(contentType);
    const image = vi.spyOn(HTMLImageElementImpl.prototype, 'loadDocumentResource').mockImplementation(() => {});
    const media = vi.spyOn(HTMLMediaElementImpl.prototype, 'loadDocumentResource').mockImplementation(() => {});
    const document = (await load())!;
    expect(document.type).toBe('html');
    expect(document.contentType).toBe(contentType);
    expect(document.mode).toBe(DocumentMode.NoQuirks);
    expect(document.compatMode).toBe('CSS1Compat');
    expect(document.doctype).toBeNull();
    expect(document.documentElement?.localName).toBe('html');
    expect([...document.documentElement!.children].map((child) => child.localName)).toEqual(['head', 'body']);
    expect(document.head!.childNodes.length).toBe(0);
    expect(document.body!.children.length).toBe(1);
    const host = document.body!.firstElementChild!;
    expect(host.localName).toBe(tag);
    expect(host.namespaceURI).toBe(HTML_NAMESPACE);
    expect(host.nodeDocument).toBe(document);
    expect(host.getAttribute('src')).toBe('https://example.test/final?media=1#resource');
    expect(document.URL).toBe(host.getAttribute('src'));
    expect(document.activeParser).toBeNull();
    expect(document.readyState).toBe('loading');
    expect(navigable.activeDocument).not.toBe(document);
    const owner = tag === 'img' ? image : media;
    expect(owner).toHaveBeenCalledExactlyOnceWith(resource);
    expect(owner.mock.instances[0]).toBe(host);
    expect(resource.response).toBe(response);
    expect(tag === 'img' ? media : image).not.toHaveBeenCalled();
    const window = document.env.realm.globalObject as Window;
    expect(window.document.body!.firstElementChild).toBeInstanceOf(
      tag === 'img' ? window.HTMLImageElement : tag === 'audio' ? window.HTMLAudioElement : window.HTMLVideoElement,
    );
    expect(document.duringLoadingNavigationID).toBe(params.id);
  });

  it('retains sniffed bytes and the same reader for the image-loading owner', async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { resource, load } = await fixture(undefined, bytes);
    expect(resource.mimeType.type).toBe('image');
    const adopt = vi.spyOn(HTMLImageElementImpl.prototype, 'loadDocumentResource').mockImplementation(() => {});
    const document = (await load())!;
    expect(document.contentType).toBe('image/png');
    expect(adopt).toHaveBeenCalledExactlyOnceWith(resource);
    await expect(resource.read()).resolves.toEqual(bytes);
    await expect(resource.read()).resolves.toBeNull();
  });

  it('processes media Link headers after construction, then waits for activation before delivering completion events', async () => {
    const { navigable, params, resource, load } = await fixture('image/png');
    const order: string[] = [];
    const links = vi.spyOn(DocumentImpl.prototype, 'processLinkHeaders');
    vi.spyOn(HTMLImageElementImpl.prototype, 'loadDocumentResource').mockImplementation(function(this: HTMLImageElementImpl, reader) {
      expect(reader).toBe(resource);
      expect(this.parentElement).toBe(this.nodeDocument.body);
      expect(this.getAttribute('src')).toBe(this.nodeDocument.URL);
      expect(links.mock.calls.map(([, phase]) => phase)).toEqual(['pre-media']);
      order.push('resource');
    });
    const document = (await load())!;
    const env = document.env;
    const loop = env.responsibleEventLoop;
    const queue = vi.spyOn(env, 'queueTask');
    const finish = vi.spyOn(document, 'finishLoading');
    const window = env.realm.globalObject as Window;
    window.document.addEventListener('DOMContentLoaded', () => { order.push('DOMContentLoaded'); });
    window.addEventListener('load', () => {
      expect(loop.currentlyRunningTask?.source).toBe(networkingTaskSource);
      order.push('load');
    });
    expect(links.mock.calls.map(([, phase]) => phase)).toEqual(['pre-media', 'media']);
    expect(order).toEqual(['resource']);
    expect(loop.runTaskTurn()).toBe(false);
    expect(finish).not.toHaveBeenCalled();
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    // This fixture disables host turns; explicitly advance its owning microtask queue too.
    await expect.poll(() => {
      loop.performMicrotaskCheckpoint();
      return queue.mock.calls.some(([source]) => source === 'network');
    }).toBe(true);
    expect(finish).not.toHaveBeenCalled();
    expect(loop.runTaskTurn()).toBe(true);
    expect(finish).toHaveBeenCalledOnce();
    expect(document.readyState).toBe('complete');
    expect(order).toEqual(['resource', 'DOMContentLoaded', 'load']);
  });

  it('discards queued completion when the Document is destroyed', async () => {
    const { navigable, params, load } = await fixture('image/png');
    vi.spyOn(HTMLImageElementImpl.prototype, 'loadDocumentResource').mockImplementation(() => {});
    const document = (await load())!;
    document.env.queueTask('network', { run: () => { document.destroy(); } });
    const queue = vi.spyOn(document.env, 'queueTask');
    const finish = vi.spyOn(document, 'finishLoading');
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    await expect.poll(() => {
      document.env.responsibleEventLoop.performMicrotaskCheckpoint();
      return queue.mock.calls.some(([source]) => source === 'network');
    }).toBe(true);
    expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(document.env.responsibleEventLoop.runTaskTurn()).toBe(false);
    expect(finish).not.toHaveBeenCalled();
  });

  it('delivers completion through the automatic loop without an explicit checkpoint', async () => {
    const { navigable, params, load } = await fixture('image/png', undefined, new UserAgent());
    vi.spyOn(HTMLImageElementImpl.prototype, 'loadDocumentResource').mockImplementation(() => {});
    const document = (await load())!;
    const window = document.env.realm.globalObject as Window;
    const loaded = new Promise<void>((resolve) => { window.addEventListener('load', () => { resolve(); }); });
    expect(document.readyState).toBe('loading');
    navigable.finalizeCrossDocumentNavigation('replace', 'browser UI', navigable.createHistoryEntry(document, params));
    await loaded;
    expect(document.readyState).toBe('complete');
    // The load callback's checkpoint can resume this test before dispatch has returned.
    await expect.poll(() => document.loadTimingInfo.loadEventEndTime).toBeGreaterThan(0);
  });

  it.each([
    ['image/png', 'Image document resource loading is not implemented'],
    ['audio/ogg', 'Audio/video document resource loading is not implemented'],
    ['video/webm', 'Audio/video document resource loading is not implemented'],
  ] as const)('keeps %s element loading explicit instead of completing an unconsumed response', async (contentType, message) => {
    const { load } = await fixture(contentType);
    const finish = vi.spyOn(DocumentImpl.prototype, 'finishLoading');
    await expect(load()).rejects.toThrow(message);
    expect(finish).not.toHaveBeenCalled();
  });

  it('leaves application/ogg track classification with media resource selection', async () => {
    const { navigable, load } = await fixture('application/ogg');
    const create = vi.spyOn(navigable, 'createAndInitializeDocument');
    await expect(load()).rejects.toThrow('Media document element selection requires decoded track information');
    expect(create).not.toHaveBeenCalled();
  });
});

async function fixture(contentType: string | undefined, bytes = new Uint8Array(), userAgent = createManualUserAgent()) {
  const navigable = TopLevelTraversable.create(userAgent, null, 'media');
  const env = navigable.activeWindow!.env;
  const response = new FetchResponse();
  response.urlList = [env.parseURL('https://example.test/start')!, env.parseURL('https://example.test/final?media=1#resource')!];
  if (contentType !== undefined) response.headerList.append('Content-Type', contentType);
  response.body = FetchBody.fromBytes(bytes, userAgent.sandbox);
  const resource = new ResourceReader(response, userAgent);
  await resource.determineMIMEType();
  vi.spyOn(userAgent, 'supportsMIMEType').mockReturnValue(true);
  const params = navigable.createNavigationParams(response);
  return {
    navigable, params, response, resource,
    load: () => navigable.loadDocument(params, new SourceSnapshotParams(null), null, resource),
  };
}
