import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { parseURL } from '../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('History foundations', () => {
  it('exposes a stable History with the initial entry and null state', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => ({
      available: typeof History,
      stable: window.history === window.history,
      length: window.history.length,
      state: window.history.state as unknown,
      scroll: window.history.scrollRestoration,
    }))).toEqual({ available: 'function', stable: true, length: 1, state: null, scroll: 'auto' });
  });

  it('updates stored length through the existing push and replace commit path', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    expect(browser.window.history.length).toBe(1);
    await browser.navigate('https://example.test/second');
    expect(browser.window.history.length).toBe(2);
    await browser.navigate('https://example.test/second');
    expect(browser.window.history.length).toBe(2);
    expect(unwrap<DocumentImpl>(browser.document).history.index).toBe(1);
  });

  it('counts distinct joint-history steps, including nested entries and gaps', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const traversable = document.getNodeNavigable()!.traversable;
    const state = DocumentState.create(document);
    const entries = [0, 3, 7].map((step) => Object.assign(document.env.createSessionHistoryEntry(document.url, state), { step }));
    // Child-history production is unfinished; supply its retained lists at their owner boundary.
    const nested = [1, 3].map((step) => Object.assign(
      document.env.createSessionHistoryEntry(document.url, DocumentState.create(document)), { step },
    ));
    state.nestedHistories.push({ id: Symbol('child'), entries: nested });
    traversable.sessionHistoryEntries = entries;
    expect(traversable.getHistoryLengthAndIndex(3)).toEqual([4, 2]);
    // The getter reads its stored snapshot until history application updates it.
    expect(browser.window.history.length).toBe(1);
  });

  it('retains the stored state value instead of cloning it on each read', async () => {
    const browser = new Browlet({ route: () => '' });
    const state = await browser.evaluate(() => ({ saved: ['value'] }));
    // State restoration will supply this deserialized value; it is outside the foundations slice.
    unwrap<DocumentImpl>(browser.document).history.stateValue = state;
    expect(browser.window.history.state).toBe(state);
    expect(browser.window.history.state).toBe(browser.window.history.state);
  });

  it('makes History nonconstructible and exposes read-only length and state', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      let constructible = true;
      try { Reflect.construct(History, []); } catch (error) { constructible = !(error instanceof TypeError); }
      return {
        branded: history instanceof History,
        constructible,
        lengthWritable: Reflect.set(history, 'length', 9),
        stateWritable: Reflect.set(history, 'state', 'replacement'),
      };
    })).toEqual({ branded: true, constructible: false, lengthWritable: false, stateWritable: false });
  });

  it('keeps scroll restoration on the active entry', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      history.scrollRestoration = 'manual';
      return history.scrollRestoration;
    })).toBe('manual');
    const document = unwrap<DocumentImpl>(browser.document);
    const navigable = document.getNodeNavigable()!;
    expect(navigable.activeSessionHistoryEntry.scrollRestorationMode).toBe('manual');
    navigable.currentSessionHistoryEntry = document.env.createSessionHistoryEntry(document.url, DocumentState.create(document));
    expect(browser.window.history.scrollRestoration).toBe('manual');
    browser.window.history.scrollRestoration = 'auto';
    expect(navigable.activeSessionHistoryEntry.scrollRestorationMode).toBe('auto');
    navigable.currentSessionHistoryEntry = navigable.activeSessionHistoryEntry;
    await browser.navigate('https://example.test/next');
    expect(browser.window.history.scrollRestoration).toBe('auto');
  });

  it('uses Web IDL enum conversion before accessing the active Document', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      let coercions = 0;
      Reflect.set(history, 'scrollRestoration', { toString() { coercions++; return 'manual'; } });
      Reflect.set(history, 'scrollRestoration', 'invalid');
      let symbolError = false;
      try { Reflect.set(history, 'scrollRestoration', Symbol()); } catch (error) { symbolError = error instanceof TypeError; }
      return { coercions, scroll: history.scrollRestoration, symbolError };
    })).toEqual({ coercions: 1, scroll: 'manual', symbolError: true });
    const history = browser.window.history;
    const DOMException = browser.window.DOMException;
    unwrap<DocumentImpl>(browser.document).browsingContext = null;
    expect(() => Reflect.set(history, 'scrollRestoration', 'invalid')).not.toThrow();
    expect(() => Reflect.set(history, 'scrollRestoration', 'auto')).toThrow(DOMException);
  });

  it('replaces the Document-owned History even when the initial Window is reused', () => {
    const browser = new Browlet({ route: () => '' });
    const window = getRelevantRealm(browser.window).windowImplementation;
    const oldDocument = window.document;
    const oldHistory = browser.window.history;
    const navigable = window.navigable!;
    const params = navigable.createNavigationParamsFromSource(parseURL('about:blank?replacement').url!);
    params.origin = oldDocument.origin;
    const document = navigable.createAndInitializeDocument('html', 'text/html', params);
    navigable.finalizeCrossDocumentNavigation('replace', 'none', navigable.createHistoryEntry(document, params));

    expect(getRelevantRealm(browser.window).windowImplementation).toBe(window);
    expect(document.history).not.toBe(oldDocument.history);
    expect(browser.window.history).not.toBe(oldHistory);
    expect(getRelevantRealm(browser.window.history)).toBe(getRelevantRealm(oldHistory));
    expect(browser.window.history.length).toBe(1);
    // Activity is checked against the relevant global's current Document, not the old owning Document.
    expect(oldDocument.isFullyActive()).toBe(false);
    expect(oldHistory.length).toBe(1);
  });

  it('uses the receiver Document when another Window supplies the accessor', async () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    await first.navigate('https://example.test/first');
    await first.navigate('https://example.test/second');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Apply the borrowed getter to explicit receivers.
    const getter = Object.getOwnPropertyDescriptor(second.window.History.prototype, 'length')!.get!;
    const firstHistory = first.window.history;
    expect(Reflect.apply(getter, firstHistory, [])).toBe(2);
    expect(() => { Reflect.apply(getter, {}, []); }).toThrow(getRelevantRealm(second.window).TypeError);
    unwrap<DocumentImpl>(first.document).browsingContext = null;
    expect(() => { Reflect.apply(getter, firstHistory, []); }).toThrow(second.window.DOMException);
  });

  it.each(['length', 'state', 'scrollRestoration'] as const)('rejects %s on a retained inactive History', async (property) => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('https://example.test/first');
    const history = browser.window.history;
    const DOMException = browser.window.DOMException;
    await browser.navigate('https://example.test/second');
    let error: unknown;
    try { Reflect.get(history, property); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(DOMException);
    expect(error).toMatchObject({ name: 'SecurityError' });
  });
});
