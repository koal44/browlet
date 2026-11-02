import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { createSessionHistoryEntry, createDocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { NavigationHistoryEntryImpl } from '../../../src/browlet/browsing/navigation/api/navigation-history-entry';
import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../src/url/index';
import { getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('Navigation activation', () => {
  it('starts null and exposes a nonconstructible interface', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      let illegalConstructor = false;
      try { Reflect.construct(NavigationActivation, []); } catch (error) { illegalConstructor = error instanceof TypeError; }
      return { activation: navigation.activation, illegalConstructor };
    })).toEqual({ activation: null, illegalConstructor: true });
  });

  it('initializes the replacement of initial about:blank before parser scripts run', async () => {
    const browser = new Browlet({ route: () => '<script>globalThis.activationAtParse = navigation.activation;</script>' });
    await browser.navigate('https://example.test/first');
    expect(await browser.evaluate(() => {
      const activation = navigation.activation!;
      return {
        parsed: Reflect.get(globalThis, 'activationAtParse') === activation,
        stable: navigation.activation === activation, current: activation.entry === navigation.currentEntry,
        from: activation.from, type: activation.navigationType,
        branded: activation instanceof NavigationActivation, tag: Object.prototype.toString.call(activation),
        url: activation.entry.url,
      };
    })).toEqual({
      parsed: true, stable: true, current: true, from: null, type: 'replace',
      branded: true, tag: '[object NavigationActivation]', url: 'https://example.test/first',
    });
  });

  it('reuses the listed predecessor in the destination realm after a same-origin push', async () => {
    const { browser } = await fixture();
    browser.window.navigation.updateCurrentEntry({ state: { items: [1] } });
    const previous = browser.window.navigation.currentEntry!;
    const previousRealm = getRelevantRealm(previous);
    await browser.navigate('https://example.test/next');
    const navigation = browser.window.navigation;
    const activation = navigation.activation!;
    expect(activation.from).toBe(navigation.entries()[0]);
    expect(activation.entry).toBe(navigation.currentEntry);
    expect(activation.navigationType).toBe('push');
    expect(activation.from).not.toBe(previous);
    expect(activation.from).toMatchObject({ url: 'https://example.test/current', index: 0, sameDocument: false });
    expect(activation.from!.getState()).toEqual({ items: [1] });
    const realm = getRelevantRealm(browser.window);
    expect(getRelevantRealm(activation)).toBe(realm);
    expect(getRelevantRealm(activation.from!)).toBe(realm);
    expect(realm).not.toBe(previousRealm);
  });

  it('retains an unlisted replacement predecessor, including its URL and fresh state', async () => {
    const { browser } = await fixture();
    browser.window.navigation.updateCurrentEntry({ state: { items: ['retained'] } });
    const { key, id } = browser.window.navigation.currentEntry!;
    // Browlet's current host navigation resolves a same-URL load to replacement, not reload.
    await browser.navigate('https://example.test/current');
    const navigation = browser.window.navigation;
    const activation = navigation.activation!;
    const from = activation.from!;
    expect(activation.navigationType).toBe('replace');
    expect(activation.entry).toBe(navigation.currentEntry);
    expect(activation.entry.key).toBe(key);
    expect(activation.entry.id).not.toBe(id);
    expect(from).toMatchObject({ key, id, url: 'https://example.test/current', index: -1, sameDocument: false });
    expect(navigation.entries()).not.toContain(from);
    const state = from.getState() as { items: string[]; };
    state.items.push('changed');
    expect(from.getState()).toEqual({ items: ['retained'] });
    expect(state.items).toBeInstanceOf(getRelevantRealm(browser.window).Array);
  });

  it('does not expose a cross-origin predecessor', async () => {
    const { browser } = await fixture();
    await browser.navigate('https://other.test/next');
    expect(browser.window.navigation.activation!.from).toBeNull();
    expect(browser.window.navigation.activation!.navigationType).toBe('push');
    expect(browser.window.navigation.activation!.entry).toBe(browser.window.navigation.currentEntry);
  });

  it('keeps attributes readonly and rejects invalid getter receivers in the method realm', async () => {
    const { browser } = await fixture();
    expect(await browser.evaluate(() => {
      const activation = navigation.activation!;
      const names = ['from', 'entry', 'navigationType'];
      const rejected = names.map((name) => {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the getter's brand check.
        const getter = Object.getOwnPropertyDescriptor(NavigationActivation.prototype, name)!.get!;
        try { Reflect.apply(getter, {}, []); } catch (error) { return error instanceof TypeError; }
        return false;
      });
      return {
        writable: [Reflect.set(navigation, 'activation', null), ...names.map((name) => Reflect.set(activation, name, null))],
        rejected,
      };
    })).toEqual({ writable: [false, false, false, false], rejected: [true, true, true] });
  });

  it('preserves receiver-realm endpoints when getters are borrowed', async () => {
    const { browser } = await fixture();
    await browser.navigate('https://example.test/next');
    const other = new Browlet({ route: () => '' });
    const activation = browser.window.navigation.activation!;
    const ownerRealm = getRelevantRealm(browser.window);
    const methodRealm = getRelevantRealm(other.window);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrow Navigation's attribute getter as well.
    const activationGetter = Object.getOwnPropertyDescriptor(other.window.Navigation.prototype, 'activation')!.get!;
    expect(Reflect.apply(activationGetter, browser.window.navigation, [])).toBe(activation);
    expect(() => { Reflect.apply(activationGetter, {}, []); }).toThrow(methodRealm.TypeError);
    for (const name of ['from', 'entry'] as const) {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Borrow a foreign getter with an explicit receiver.
      const getter = Object.getOwnPropertyDescriptor(other.window.NavigationActivation.prototype, name)!.get!;
      const value: unknown = Reflect.apply(getter, activation, []);
      expect(value).toBe(activation[name]);
      expect(value).toBeInstanceOf(ownerRealm.Object);
      expect(value).not.toBeInstanceOf(methodRealm.Object);
      expect(() => { Reflect.apply(getter, {}, []); }).toThrow(methodRealm.TypeError);
    }
  });

  it('leaves activation unchanged by same-document entry replacement', async () => {
    const { browser, navigation, document, current } = await fixture();
    const activation = browser.window.navigation.activation!;
    const originalEntry = activation.entry;
    const replacement = {
      ...createSessionHistoryEntry({ ...current.documentState, document }), url: document.env.parseHTMLURL('#replaced')!,
    };
    // The same-document commit producer is unfinished; supply its completed list edit at the owner boundary.
    navigation.entryList = [new NavigationHistoryEntryImpl(replacement, document.env)];
    navigation.currentEntryIndex = 0;
    navigation.updateActivation('replace', current);
    expect(browser.window.navigation.activation).toBe(activation);
    expect(activation.entry).toBe(originalEntry);
    expect(activation.navigationType).toBe('replace');
    expect(originalEntry.index).toBe(-1);
    expect(originalEntry.url).toBe('https://example.test/current');
    expect(browser.window.navigation.currentEntry!.url).toBe('https://example.test/current#replaced');
  });

  it('does not update without a previous entry or navigation type', async () => {
    const { browser, navigation, current } = await fixture();
    const activation = browser.window.navigation.activation;
    navigation.updateActivation('traverse');
    navigation.updateActivation(null, current);
    expect(browser.window.navigation.activation).toBe(activation);
    expect(activation!.navigationType).toBe('replace');
  });

  it('updates a retained activation for reload even when the entry keeps its Document', async () => {
    const { browser, navigation, current } = await fixture();
    const activation = browser.window.navigation.activation!;
    // Actual reload/history restoration is unfinished; provide its activation inputs directly.
    navigation.updateActivation('reload', current);
    expect(browser.window.navigation.activation).toBe(activation);
    expect(activation.navigationType).toBe('reload');
    expect(activation.from).toBe(activation.entry);
    expect(activation.entry).toBe(browser.window.navigation.currentEntry);
  });

  it.each(['cross-origin', 'noncontiguous'] as const)('clears stale from on %s reactivation without replacing the activation', async (kind) => {
    const { browser } = await fixture();
    await browser.navigate('https://example.test/next');
    const document = unwrap<DocumentImpl>(browser.document);
    const navigation = document.getRelevantGlobalObject()!.navigation;
    const activation = browser.window.navigation.activation!;
    const entry = activation.entry;
    expect(activation.from).not.toBeNull();
    const previous = { ...navigation.entryList[0]!.sessionHistoryEntry };
    if (kind === 'cross-origin') {
      previous.documentState = { ...previous.documentState, origin: obtainURLOrigin(parseURL('https://other.test/').url!) };
    }
    // History restoration is unfinished; exercise its activation step with an unlisted predecessor.
    navigation.updateActivation('traverse', previous);
    expect(browser.window.navigation.activation).toBe(activation);
    expect(activation).toMatchObject({ from: null, entry, navigationType: 'traverse' });
    expect(getRelevantRealm(activation)).toBe(getRelevantRealm(browser.window));
  });

  it('updates both retained endpoints when history selects a different entry', async () => {
    const { browser } = await fixture();
    await browser.navigate('https://example.test/next');
    const document = unwrap<DocumentImpl>(browser.document);
    const navigation = document.getRelevantGlobalObject()!.navigation;
    const activation = browser.window.navigation.activation!;
    const previous = navigation.entryList[0]!.sessionHistoryEntry;
    const destination = createSessionHistoryEntry({ ...navigation.currentEntry!.sessionHistoryEntry.documentState, document });
    // Supply history application's selected entry without claiming that its traversal/events are implemented.
    navigation.entryList.push(new NavigationHistoryEntryImpl(destination, document.env));
    navigation.currentEntryIndex = navigation.entryList.length - 1;
    navigation.updateActivation('traverse', previous);
    expect(browser.window.navigation.activation).toBe(activation);
    expect(activation.entry).toBe(browser.window.navigation.currentEntry);
    expect(activation.from).toBe(browser.window.navigation.entries()[0]);
    expect(activation.navigationType).toBe('traverse');
  });

  it('keeps activation null for a loaded opaque-origin Document', async () => {
    const browser = new Browlet({ route: () => '' });
    await browser.navigate('data:text/html,opaque');
    expect(browser.window.navigation.currentEntry).toBeNull();
    expect(browser.window.navigation.activation).toBeNull();
  });

  it.each(['inactive', 'initial', 'opaque'] as const)('does not create or update activation with %s entries disabled', async (reason) => {
    const { browser, navigation, document, current } = await fixture();
    const platform = browser.window.navigation;
    const activation = platform.activation!;
    if (reason === 'inactive') document.browsingContext = null;
    else if (reason === 'initial') document.isInitialAboutBlank = true;
    else document.origin = createOpaqueOrigin();
    navigation.updateActivation('reload', current);
    expect(platform.activation).toBe(activation);
    expect(activation.from).toBeNull();
    expect(activation.navigationType).toBe('replace');
    navigation.activation = null;
    navigation.updateActivation('reload', current);
    expect(platform.activation).toBeNull();
  });

  it.each(['replace', 'detach'] as const)('retains activation and its endpoint identities after Document %s', async (change) => {
    const { browser, document } = await fixture();
    browser.window.navigation.updateCurrentEntry({ state: { value: 'before' } });
    const navigation = browser.window.navigation;
    const activation = navigation.activation!;
    const entry = activation.entry;
    if (change === 'replace') await browser.navigate('https://example.test/next');
    else document.browsingContext = null;
    expect(navigation.currentEntry).toBeNull();
    expect(navigation.activation).toBe(activation);
    expect(activation.entry).toBe(entry);
    expect(activation.from).toBeNull();
    expect(activation.navigationType).toBe('replace');
    expect(entry).toMatchObject({ url: '', key: '', id: '', index: -1, sameDocument: false });
    expect(entry.getState()).toBeUndefined();
  });

  it('hides an initial about:blank predecessor even with an inherited same origin', async () => {
    const { browser, document, navigation } = await fixture();
    const initial = new Browlet({ route: () => '' });
    const initialDocument = unwrap<DocumentImpl>(initial.document);
    const previousState = createDocumentState(initialDocument);
    previousState.origin = document.origin;
    navigation.updateActivation('replace', createSessionHistoryEntry(previousState));
    expect(browser.window.navigation.activation!.from).toBeNull();
  });

  it('does not reconstruct a replacement predecessor using document.domain relaxation', async () => {
    const { browser, document, navigation, current } = await fixture();
    const platform = browser.window.navigation;
    const previousBrowser = new Browlet({ route: () => '' });
    await previousBrowser.navigate('https://child.example.test/previous');
    const previousDocument = unwrap<DocumentImpl>(previousBrowser.document);
    expect(document.origin.kind).toBe('tuple');
    expect(previousDocument.origin.kind).toBe('tuple');
    if (document.origin.kind !== 'tuple' || previousDocument.origin.kind !== 'tuple') throw new Error('Tuple fixture required');
    document.origin.domain = previousDocument.origin.domain = parseURL('https://example.test/').url!.host!;
    navigation.updateActivation('replace', previousDocument.getNodeNavigable()!.activeSessionHistoryEntry);
    expect(platform.activation!.from).toBeNull();
    expect(navigation.currentEntry!.sessionHistoryEntry).toBe(current);
  });

  it('keeps the missing previous-Document dependency explicit for unlisted replacements', async () => {
    const { browser, navigation, current } = await fixture();
    const previous = { ...current, documentState: { ...current.documentState, document: null } };
    const activation = browser.window.navigation.activation;
    expect(() => navigation.updateActivation('replace', previous))
      .toThrow('requires the previous Document');
    expect(browser.window.navigation.activation).toBe(activation);
  });
});

async function fixture() {
  const browser = new Browlet({ route: () => '' });
  await browser.navigate('https://example.test/current');
  const document = unwrap<DocumentImpl>(browser.document);
  const navigation = document.getRelevantGlobalObject()!.navigation;
  const current = document.getNodeNavigable()!.activeSessionHistoryEntry;
  return { browser, document, navigation, current };
}

describe('NavigationActivation interface', () => {
  it('exposes a nonconstructible interface with readonly, receiver-checked attributes', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      let illegalConstructor = false;
      try { Reflect.construct(NavigationActivation, []); } catch (error) { illegalConstructor = error instanceof TypeError; }
      const attributes = ['from', 'entry', 'navigationType'].map((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(NavigationActivation.prototype, name)!;
        let receiverChecked = false;
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Exercise the getter with an invalid receiver.
        try { Reflect.apply(descriptor.get!, {}, []); } catch (error) { receiverChecked = error instanceof TypeError; }
        return {
          getter: typeof descriptor.get, readonly: descriptor.set === undefined,
          enumerable: descriptor.enumerable, configurable: descriptor.configurable, receiverChecked,
        };
      });
      return { illegalConstructor, attributes };
    })).toEqual({
      illegalConstructor: true,
      attributes: Array(3).fill({
        getter: 'function', readonly: true, enumerable: true, configurable: true, receiverChecked: true,
      }),
    });
  });
});
