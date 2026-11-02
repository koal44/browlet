/* eslint-disable @typescript-eslint/unbound-method -- Exercise borrowed History methods with explicit receivers. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext } from '../../../src/browlet/browsing/navigation/browsing-context';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { Navigable } from '../../../src/browlet/browsing/navigation/navigable';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/iframe';
import { parseURL } from '../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

// https://html.spec.whatwg.org/multipage/nav-history-apis.html#delta-traverse
describe('History traversal requests', () => {
  it('forwards go/back/forward to joint history with the receiver Document', async () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const { traverse, reload } = observeRequests(document);
    expect(await browser.evaluate(() => [history.go(2), history.back(), history.forward()]))
      .toEqual([undefined, undefined, undefined]);
    expect(traverse.mock.calls).toEqual([[2, document], [-1, document], [1, document]]);
    expect(traverse.mock.contexts).toEqual(Array(3).fill(document.getNodeNavigable()!.traversable));
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads for omitted, undefined, and converted zero deltas', async () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const { reload, traverse } = observeRequests(document);
    expect(await browser.evaluate(() => {
      history.go();
      for (const value of [undefined, null, 0, -0, NaN, Infinity, -Infinity, 0.9, 2 ** 32]) {
        Reflect.apply(history.go, history, [value]);
      }
      return [history.go.length, history.back.length, history.forward.length];
    })).toEqual([0, 0, 0]);
    expect(reload).toHaveBeenCalledTimes(10);
    expect(reload.mock.calls.every((args) => args.length === 0)).toBe(true);
    expect(reload.mock.contexts.every((receiver) => receiver === document.getNodeNavigable())).toBe(true);
    expect(traverse).not.toHaveBeenCalled();
  });

  it('applies signed long conversion before forwarding deltas, without an eager bounds check', async () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const { traverse } = observeRequests(document);
    await browser.evaluate(() => {
      for (const value of ['2', 1.9, -1.9, 2 ** 32 + 1, -(2 ** 32) - 1, 2 ** 31]) {
        Reflect.apply(history.go, history, [value]);
      }
    });
    expect(traverse.mock.calls).toEqual([2, 1, -1, 1, -1, -(2 ** 31)].map((delta) => [delta, document]));
  });

  it('converts delta once and preserves conversion errors before consulting policy', async () => {
    const browser = new Browlet({ route: () => '' });
    const { blocked, traverse } = observeRequests(unwrap<DocumentImpl>(browser.document));
    expect(await browser.evaluate(() => {
      let conversions = 0;
      Reflect.apply(history.go, history, [{ valueOf() { conversions++; return -2; } }]);
      const errors = [Symbol(), 1n].map((value) => {
        try { Reflect.apply(history.go, history, [value]); }
        catch (error) { return error instanceof TypeError; }
        return false;
      });
      const sentinel = new Error('conversion failed');
      let sameError = false;
      try { Reflect.apply(history.go, history, [{ valueOf() { throw sentinel; } }]); }
      catch (error) { sameError = error === sentinel; }
      return { conversions, errors, sameError };
    })).toEqual({ conversions: 1, errors: [true, true], sameError: true });
    expect(blocked).toHaveBeenCalledOnce();
    expect(traverse).toHaveBeenCalledOnce();
  });

  it('rejects invalid receivers before converting delta', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      let conversions = 0;
      const value = { valueOf() { conversions++; return 1; } };
      const errors = [null, {}, Object.create(history) as object].map((receiver) => {
        try { Reflect.apply(history.go, receiver, [value]); }
        catch (error) { return error instanceof TypeError; }
        return false;
      });
      return { conversions, errors };
    })).toEqual({ conversions: 0, errors: [true, true, true] });
  });

  it('returns without requesting reload or traversal when policy blocks', async () => {
    const browser = new Browlet({ route: () => '' });
    const { blocked, reload, traverse } = observeRequests(unwrap<DocumentImpl>(browser.document));
    blocked.mockReturnValue(true);
    expect(await browser.evaluate(() => [history.go(), history.go(3), history.back(), history.forward()]))
      .toEqual([undefined, undefined, undefined, undefined]);
    expect(blocked).toHaveBeenCalledTimes(4);
    expect(reload).not.toHaveBeenCalled();
    expect(traverse).not.toHaveBeenCalled();
  });

  it('keeps back and forward independent of an author replacement for go', async () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const { traverse } = observeRequests(document);
    await browser.evaluate(() => {
      history.go = () => { throw new Error('Author go must not run'); };
      history.back();
      history.forward();
    });
    expect(traverse.mock.calls).toEqual([[-1, document], [1, document]]);
  });

  it.each(['go', 'back', 'forward'] as const)('rejects retained inactive History.%s before policy', async (method) => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const history = browser.window.history;
    const DOMException = browser.window.DOMException;
    const { blocked, reload, traverse } = observeRequests(unwrap<DocumentImpl>(browser.document));
    await browser.navigate('https://example.test/second');
    let error: unknown;
    try { history[method](); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ name: 'SecurityError' });
    expect(blocked).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(traverse).not.toHaveBeenCalled();
  });

  it('checks activity again after author conversion can detach the receiver Document', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const history = browser.window.history;
    const DOMException = browser.window.DOMException;
    const { blocked } = observeRequests(document);
    const delta = { valueOf() { document.browsingContext = null; return 1; } };
    expect(() => { Reflect.apply(history.go, history, [delta]); }).toThrow(DOMException);
    expect(blocked).not.toHaveBeenCalled();
  });

  it('borrows methods without switching receiver ownership or exception realm', () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(first.document);
    const { traverse } = observeRequests(document);
    const method = second.window.history.go;
    const history = first.window.history;
    expect(Reflect.apply(method, history, [-1])).toBeUndefined();
    expect(traverse).toHaveBeenCalledExactlyOnceWith(-1, document);
    expect(() => { Reflect.apply(method, {}, []); }).toThrow(getRelevantRealm(second.window).TypeError);
    document.browsingContext = null;
    expect(() => { Reflect.apply(method, history, []); }).toThrow(second.window.DOMException);
  });

  it('uses a reused Window\'s replacement Document for a retained History', () => {
    const browser = new Browlet({ route: () => '' });
    const window = getRelevantRealm(browser.window).windowImplementation;
    const oldHistory = browser.window.history;
    const navigable = window.navigable!;
    const params = navigable.createNavigationParamsFromSource(parseURL('about:blank?replacement').url!);
    params.origin = window.document.origin;
    const document = navigable.createAndInitializeDocument('html', 'text/html', params);
    navigable.finalizeCrossDocumentNavigation('replace', 'none', navigable.createHistoryEntry(document, params));
    const { traverse } = observeRequests(document);
    oldHistory.back();
    expect(traverse).toHaveBeenCalledExactlyOnceWith(-1, document);
  });

  it('reloads a child itself but traverses its containing joint history', () => {
    const browser = new Browlet({ route: () => '' });
    const parentDocument = unwrap<DocumentImpl>(browser.document);
    const container = parentDocument.createElement('iframe') as HTMLIFrameElementImpl;
    const [, document] = BrowsingContext.createTopLevel(parentDocument.env.userAgent);
    const navigable = new Navigable(createDocumentState(document), parentDocument.getNodeNavigable());
    // Child creation is unfinished; connect the real implementations at their retained association.
    container.contentNavigable = navigable;
    parentDocument.body!.appendChild(container);
    const { reload, traverse, blocked } = observeRequests(document);
    const history = getRelevantRealm(document).windowProxy.platform.history;
    history.go();
    history.back();
    expect(reload.mock.contexts).toEqual([navigable]);
    expect(blocked.mock.contexts).toEqual([navigable, navigable]);
    expect(traverse).toHaveBeenCalledExactlyOnceWith(-1, document);
    expect(traverse.mock.contexts).toEqual([parentDocument.getNodeNavigable()!.traversable]);
  });
});

/** Observe requests at navigation's owner boundary without simulating unfinished traversal or reload. */
function observeRequests(document: DocumentImpl) {
  const navigable = document.getNodeNavigable()!;
  return {
    blocked: vi.spyOn(navigable, 'isNavigationOrHistoryUpdateBlocked'),
    reload: vi.spyOn(navigable, 'reload').mockImplementation(() => {}),
    traverse: vi.spyOn(navigable.traversable, 'traverseHistoryByDelta').mockImplementation(() => {}),
  };
}
