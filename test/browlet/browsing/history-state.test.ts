import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { parseURL, serializeURL } from '../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe.each(['pushState', 'replaceState'] as const)('History.%s preparation', (method) => {
  it('passes one serialized snapshot and the selected URL through cancellation to history update', async () => {
    const { browser, document, event, update } = await createFixture();
    await browser.evaluate((method) => {
      const data = { value: 1, same: [] as unknown[] };
      data.same.push(data);
      history[method](data, '', '../next?q=1#fragment');
      data.value = 2;
    }, method);
    const handling = method === 'pushState' ? 'push' : 'replace';
    expect(event).toHaveBeenCalledOnce();
    const [kind, url, sameDocument, options] = event.mock.calls[0]!;
    expect(kind).toBe(handling);
    expect(sameDocument).toBe(true);
    expect(serializeURL(url)).toBe('https://example.test/next?q=1#fragment');
    const serialized = options!.classicHistoryAPIState!;
    const clone = document.env.deserialize(serialized) as { value: number; same: unknown[]; };
    expect(clone.value).toBe(1);
    expect(clone.same[0]).toBe(clone);
    expect(update).toHaveBeenCalledExactlyOnceWith(url, serialized, handling);
  });

  it('requires both arguments and converts unused and URL before serializing state', async () => {
    const { browser } = await createFixture();
    expect(await browser.evaluate((method) => {
      const order: string[] = [];
      const data = { get value() { order.push('data'); return 1; } };
      const unused = { toString() { order.push('unused'); return 'ignored'; } };
      const url = { toString() { order.push('url'); return '?next'; } };
      Reflect.apply(history[method], history, [data, unused, url]);
      const missing = [[], [null]].map((args) => {
        try { Reflect.apply(history[method], history, args); } catch (error) { return error instanceof TypeError; }
        return false;
      });
      return { order, missing, length: history[method].length };
    }, method)).toEqual({ order: ['unused', 'url', 'data'], missing: [true, true], length: 2 });
  });

  it('checks activity before state getters on an already inactive receiver', async () => {
    const { browser, document, event, update } = await createFixture();
    const history = browser.window.history;
    const DOMException = browser.window.DOMException;
    document.browsingContext = null;
    const read = vi.fn(() => { throw new RangeError('must not serialize'); });
    expect(() => history[method]({ get value() { return read(); } }, '')).toThrow(DOMException);
    expect(() => history[method](() => {}, '')).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(read).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects uncloneable data before invalid URLs and before the blocking policy', async () => {
    const { browser, document, event } = await createFixture();
    const blocked = vi.spyOn(document.getNodeNavigable()!, 'isNavigationOrHistoryUpdateBlocked');
    expect(await browser.evaluate((method) => {
      try { history[method](() => {}, '', 'https://other.test/'); }
      catch (error) { return error instanceof DOMException && error.name; }
      return 'returned';
    }, method)).toBe('DataCloneError');
    expect(blocked).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
  });

  it('preserves thrown state-getter errors and stops before URL parsing', async () => {
    const { browser, document, event } = await createFixture();
    const parse = vi.spyOn(document.env, 'encodingParseURL');
    const sentinel = new RangeError('state getter');
    expect(() => browser.window.history[method]({ get value() { throw sentinel; } }, '', '?next')).toThrow(sentinel);
    expect(parse).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
  });

  it('does not parse omitted, null, or empty URLs even when the base URL is foreign', async () => {
    const { browser, document: ownerDocument, event } = await createFixture();
    await browser.evaluate(() => {
      const base = document.createElement('base');
      base.href = 'https://other.test/base/';
      document.head.appendChild(base);
    });
    const parse = vi.spyOn(ownerDocument.env, 'encodingParseURL');
    const rewrite = vi.spyOn(ownerDocument, 'canHaveURLRewritten');
    await browser.evaluate((method) => {
      history[method](null, '');
      history[method](null, '', undefined);
      history[method](null, '', null);
      history[method](null, '', '');
    }, method);
    expect(event).toHaveBeenCalledTimes(4);
    expect(event.mock.calls.every((call) => call[1] === ownerDocument.url)).toBe(true);
    expect(parse).not.toHaveBeenCalled();
    expect(rewrite).not.toHaveBeenCalled();
    expect(() => browser.window.history[method](null, '', '#fragment')).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(event).toHaveBeenCalledTimes(4);
  });

  it('uses the receiver encoding and base when a different Window supplies the method', async () => {
    const { browser, document, event } = await createFixture();
    const foreign = new Browlet({ route: () => '' });
    document.encoding = 'windows-1252';
    Reflect.apply(foreign.window.history[method], browser.window.history, [null, '', '?q=é']);
    expect(serializeURL(event.mock.calls[0]![1])).toBe('https://example.test/base/current?q=%E9');
    expect(() => { Reflect.apply(foreign.window.history[method], browser.window.history, [null, '', 'http://[']); })
      .toThrow(foreign.window.DOMException);
  });

  it('allows a policy block only after serialization and URL validation', async () => {
    const { browser, document, event, update } = await createFixture();
    const blocked = vi.spyOn(document.getNodeNavigable()!, 'isNavigationOrHistoryUpdateBlocked').mockReturnValue(true);
    let reads = 0;
    const data = { get value() { reads++; return 1; } };
    expect(() => browser.window.history[method](data, '', 'https://other.test/')).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(blocked).not.toHaveBeenCalled();
    expect(browser.window.history[method](data, '', '?allowed')).toBeUndefined();
    expect(reads).toBe(2);
    expect(blocked).toHaveBeenCalledOnce();
    expect(event).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('stops when the Navigation event cancels or throws', async () => {
    const { browser, event, update } = await createFixture();
    event.mockReturnValue(false);
    expect(browser.window.history[method](null, '', '?cancelled')).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    const sentinel = new RangeError('event failure');
    event.mockImplementation(() => { throw sentinel; });
    expect(() => browser.window.history[method](null, '', '?throwing')).toThrow(sentinel);
    expect(update).not.toHaveBeenCalled();
  });

  it('reads the Document URL after state getters have run', async () => {
    const { browser, document, event } = await createFixture();
    const replacementURL = parseURL('https://example.test/changed-by-getter').url!;
    browser.window.history[method]({ get value() { document.setURL(replacementURL); return 1; } }, '');
    expect(event.mock.calls[0]![1]).toBe(replacementURL);
  });

  it('throws SecurityError if serialization removes the owning navigable', async () => {
    const { browser, document, event, update } = await createFixture();
    const history = browser.window.history;
    const DOMException = browser.window.DOMException;
    const data = { get value() { document.browsingContext = null; return 1; } };
    let error: unknown;
    try { history[method](data, ''); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ name: 'SecurityError' });
    expect(event).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('History storage serialization integration', () => {
  it('rejects shared memory even when ordinary serialization can share it', async () => {
    const { browser, document, event } = await createFixture();
    const realm = getRelevantRealm(browser.window);
    vi.spyOn(realm, 'crossOriginIsolated', 'get').mockReturnValue(true);
    const buffer = new SharedArrayBuffer(4);
    expect(document.env.serialize(buffer)).toMatchObject({ type: 'SharedArrayBuffer' });
    expect(() => browser.window.history.pushState({ buffer }, ''))
      .toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    expect(event).not.toHaveBeenCalled();
  });

  it('keeps internal Navigation ownership when authors replace window.navigation', async () => {
    const { browser, event, update } = await createFixture();
    await browser.evaluate(() => {
      Object.defineProperty(window, 'navigation', { value: { replaced: true }, configurable: true });
      history.replaceState(null, '', '?next');
    });
    expect(event).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });
});

/** Observe the two unfinished owner operations without simulating their eventual history effects. */
async function createFixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/base/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigation = getRelevantRealm(browser.window).windowImplementation.navigation;
  const event = vi.spyOn(navigation, 'firePushReplaceReloadNavigateEvent').mockReturnValue(true);
  const update = vi.spyOn(document, 'updateURLAndHistory').mockImplementation(() => {});
  return { browser, document, event, update };
}
