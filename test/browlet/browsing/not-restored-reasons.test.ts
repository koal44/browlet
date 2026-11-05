import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import {
  BrowsingContext, Navigable, DocumentState,
  NotRestoredReasonsImpl, type NotRestoredReasons, type TopLevelTraversable,
} from '../../../src/browlet/browsing/navigation/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import type { NotRestoredReasons as NotRestoredReasonsPlatform } from '../../../src/browlet/platform';
import { parseURL } from '../../../src/url/index';
import { getBindingContext, getRelevantRealm, unwrap } from '../../support/browlet-binding';

describe('HTML §7.2.8: NotRestoredReasons', () => {
  it('exposes nonconstructible interfaces without inventing a Document attribute', () => {
    const browser = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browser.window);
    for (const constructor of [browser.window.NotRestoredReasonDetails, browser.window.NotRestoredReasons]) {
      const interfaceObject: unknown = constructor;
      if (typeof interfaceObject !== 'function') throw new Error('Missing interface object');
      expect(() => { Reflect.construct(interfaceObject, []); }).toThrow(realm.TypeError);
      expect(Object.getPrototypeOf(constructor.prototype)).toBe(realm.Object.prototype);
    }
    expect('notRestoredReasons' in browser.document).toBe(false);
  });

  it('preserves null fields and distinguishes an empty string or list', () => {
    const { browser, value } = fixture();
    expect(value.toJSON()).toEqual({ src: null, id: null, name: null, url: null, reasons: null, children: null });
    const empty = fixture(record({ src: '', id: '', name: '', reasons: [], children: [] }), browser).value;
    expect(empty.toJSON()).toEqual({ src: '', id: '', name: '', url: null, reasons: [], children: [] });
    expect(empty.reasons).not.toBe(empty.children);
    expect(Object.isFrozen(empty.reasons)).toBe(true);
    expect(Object.isFrozen(empty.children)).toBe(true);
  });

  it('creates recursive details and children in the requested realm and serializes URL records', () => {
    const child = record({ src: 'relative child', id: 'frame', name: 'child', reasons: [{ reason: 'lock' }], children: [] });
    const backing = record({
      url: parseURL('https://EXAMPLE.test:443/a/../page?q=é#part').url!,
      reasons: [{ reason: 'fetch' }, { reason: 'unload-listener' }], children: [child, record({ id: 'masked' })],
    });
    const { browser, value } = fixture(backing);
    expect(value.url).toBe('https://example.test/page?q=%C3%A9#part');
    expect(value.reasons!.map((detail) => detail.reason)).toEqual(['fetch', 'unload-listener']);
    expect(value.children![0]!.toJSON()).toEqual({
      src: 'relative child', id: 'frame', name: 'child', url: null, reasons: value.children![0]!.reasons, children: [],
    });
    expect(value.children![0]!.reasons![0]!.reason).toBe('lock');
    expect(value.children![1]!.reasons).toBeNull();
    expect(value.children![1]!.children).toBeNull();
    expect(Object.prototype.toString.call(value)).toBe('[object NotRestoredReasons]');
    for (const diagnostic of [value, ...value.children!]) {
      expect(diagnostic).toBeInstanceOf(browser.window.NotRestoredReasons);
      expect(getRelevantRealm(diagnostic)).toBe(getRelevantRealm(browser.window));
      if (diagnostic.reasons) {
        expect(Object.getPrototypeOf(diagnostic.reasons)).toBe(getRelevantRealm(browser.window).Array.prototype);
        for (const detail of diagnostic.reasons) {
          expect(detail).toBeInstanceOf(browser.window.NotRestoredReasonDetails);
          expect(getRelevantRealm(detail)).toBe(getRelevantRealm(browser.window));
          expect(Object.prototype.toString.call(detail)).toBe('[object NotRestoredReasonDetails]');
        }
      }
    }
  });

  it('retains each frozen array and keeps its membership unmodifiable', () => {
    const { value } = fixture(record({ reasons: [{ reason: 'fetch' }], children: [record()] }));
    const reasons = value.reasons!;
    const children = value.children!;
    expect(value.reasons).toBe(reasons);
    expect(value.children).toBe(children);
    for (const array of [reasons, children]) {
      expect(Object.isFrozen(array)).toBe(true);
      expect(Reflect.set(array, '0', null)).toBe(false);
      expect(Reflect.deleteProperty(array, '0')).toBe(false);
      expect(Reflect.set(array, 'length', 0)).toBe(false);
    }
    expect(Object.isFrozen(reasons[0])).toBe(false);
    expect(Object.isFrozen(children[0])).toBe(false);
  });

  it('captures list membership at creation while retaining the scalar backing records', () => {
    const detail = { reason: 'fetch' };
    const child = record({ name: 'old child' });
    const backing = record({ reasons: [detail], children: [child] });
    const { value } = fixture(backing);
    // Mutation precedes the first platform array getter, so lazy Binding allocation cannot recapture membership.
    backing.reasons!.push({ reason: 'websocket' });
    backing.children!.push(record());
    backing.src = 'new source';
    backing.id = '\uD800';
    backing.name = 'new name';
    backing.url = parseURL('https://example.test/changed').url!;
    detail.reason = 'lock';
    child.name = 'new child';
    expect([value.src, value.id, value.name, value.url]).toEqual(['new source', '\uD800', 'new name', 'https://example.test/changed']);
    expect(value.reasons!.map((reason) => reason.reason)).toEqual(['lock']);
    expect(value.children!.map((child) => child.name)).toEqual(['new child']);
    backing.reasons = null;
    backing.children = null;
    backing.url = null;
    expect(value.reasons).toHaveLength(1);
    expect(value.children).toHaveLength(1);
    expect(value.url).toBeNull();
  });

  it('allocates distinct objects and arrays for each creation from the same backing records', () => {
    const backing = record({ reasons: [{ reason: 'fetch' }], children: [record()] });
    const { browser, value: first } = fixture(backing);
    const { value: second } = fixture(backing, browser);
    expect(first).not.toBe(second);
    expect(first.reasons).not.toBe(second.reasons);
    expect(first.reasons![0]).not.toBe(second.reasons![0]);
    expect(first.children).not.toBe(second.children);
    expect(first.children![0]).not.toBe(second.children![0]);
  });

  it('accepts an implementation through the same diagnostic shape when creating in another realm', () => {
    const url = parseURL('https://example.test/retained').url!;
    const { browser, value: first } = fixture(record({ url, reasons: [{ reason: 'fetch' }], children: [record()] }));
    const implementation = unwrap<NotRestoredReasonsImpl>(first);
    const other = new Browlet({ route: () => '' });
    const { value: second } = fixture(implementation, other);
    expect(implementation.url).toBe(url);
    expect(first.url).toBe('https://example.test/retained');
    expect(second.url).toBe(first.url);
    expect(second.reasons![0]!.reason).toBe('fetch');
    expect(second.reasons![0]).not.toBe(first.reasons![0]);
    expect(second.children![0]).not.toBe(first.children![0]);
    expect(getRelevantRealm(first.reasons![0]!)).toBe(getRelevantRealm(browser.window));
    expect(getRelevantRealm(second.reasons![0]!)).toBe(getRelevantRealm(other.window));
    expect(getRelevantRealm(second.children![0]!)).toBe(getRelevantRealm(other.window));
  });

  it('uses default JSON member order and preserves frozen arrays and nested platform identities', () => {
    const { value } = fixture(record({ reasons: [{ reason: 'fetch' }], children: [record({ id: 'child' })] }));
    const first = value.toJSON();
    const second = value.toJSON();
    expect(Object.keys(first)).toEqual(['src', 'id', 'name', 'url', 'reasons', 'children']);
    expect(first).not.toBe(second);
    expect(Reflect.get(first, 'reasons')).toBe(value.reasons);
    expect(Reflect.get(first, 'children')).toBe(value.children);
    expect(Object.isFrozen(Reflect.get(first, 'reasons'))).toBe(true);
    expect(Object.isFrozen(Reflect.get(first, 'children'))).toBe(true);
    expect(value.reasons![0]!.toJSON()).toEqual({ reason: 'fetch' });
    expect(JSON.stringify(value)).toBe('{"src":null,"id":null,"name":null,"url":null,"reasons":[{"reason":"fetch"}],"children":[{"src":null,"id":"child","name":null,"url":null,"reasons":null,"children":null}]}');
  });

  it('reads the declared attributes for default JSON instead of shadowing author properties', () => {
    const { browser, value } = fixture(record({ name: 'backing', reasons: [{ reason: 'lock' }] }));
    const reasons = value.reasons;
    Object.defineProperties(value, {
      name: { get() { throw new Error('shadow name'); } },
      reasons: { get() { throw new Error('shadow reasons'); } },
    });
    const detail = reasons![0]!;
    Object.defineProperty(detail, 'reason', { get() { throw new Error('shadow reason'); } });
    const json = browser.window.NotRestoredReasons.prototype.toJSON.call(value);
    expect(Reflect.get(json, 'name')).toBe('backing');
    expect(Reflect.get(json, 'reasons')).toBe(reasons);
    expect(browser.window.NotRestoredReasonDetails.prototype.toJSON.call(detail)).toEqual({ reason: 'lock' });
  });

  it('keeps first-read arrays and nested platforms in the owner realm when getters are borrowed', () => {
    const { browser, value } = fixture(record({ reasons: [{ reason: 'fetch' }], children: [record()] }));
    const other = new Browlet({ route: () => '' });
    for (const name of ['reasons', 'children'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(other.window.NotRestoredReasons.prototype, name)!;
      const array = descriptor.get!.call(value) as readonly object[];
      expect(Object.getPrototypeOf(array)).toBe(getRelevantRealm(browser.window).Array.prototype);
      expect(getRelevantRealm(array[0]!)).toBe(getRelevantRealm(browser.window));
      expect(array).toBe(value[name]);
    }
  });

  it('creates borrowed JSON results in the method realm without moving the nested values', () => {
    const { browser, value } = fixture(record({ reasons: [{ reason: 'fetch' }], children: [record()] }));
    const other = new Browlet({ route: () => '' });
    const json = other.window.NotRestoredReasons.prototype.toJSON.call(value);
    const detailJSON = other.window.NotRestoredReasonDetails.prototype.toJSON.call(value.reasons![0]!);
    expect(Object.getPrototypeOf(json)).toBe(getRelevantRealm(other.window).Object.prototype);
    expect(Object.getPrototypeOf(detailJSON)).toBe(getRelevantRealm(other.window).Object.prototype);
    expect(Reflect.get(json, 'reasons')).toBe(value.reasons);
    expect(Reflect.get(json, 'children')).toBe(value.children);
    expect(Object.getPrototypeOf(value.children)).toBe(getRelevantRealm(browser.window).Array.prototype);
  });

  it('checks getter and JSON receivers and leaves attributes readonly', () => {
    const { value } = fixture(record({ reasons: [{ reason: 'fetch' }] }));
    const other = new Browlet({ route: () => '' });
    for (const name of ['src', 'id', 'name', 'url', 'reasons', 'children'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(other.window.NotRestoredReasons.prototype, name)!;
      expect(descriptor).toMatchObject({ enumerable: true, configurable: true, set: undefined });
      expect(descriptor.get!.call(value)).toBe(value[name]);
      expect(Reflect.set(value, name, null)).toBe(false);
      expect(() => { descriptor.get!.call({}); }).toThrow(getRelevantRealm(other.window).TypeError);
    }
    const detail = value.reasons![0]!;
    const descriptor = Object.getOwnPropertyDescriptor(other.window.NotRestoredReasonDetails.prototype, 'reason')!;
    expect(descriptor.get!.call(detail)).toBe('fetch');
    expect(Reflect.set(detail, 'reason', 'changed')).toBe(false);
    expect(() => { descriptor.get!.call(value); }).toThrow(getRelevantRealm(other.window).TypeError);
    expect(() => other.window.NotRestoredReasons.prototype.toJSON.call(detail)).toThrow(getRelevantRealm(other.window).TypeError);
    expect(() => other.window.NotRestoredReasonDetails.prototype.toJSON.call(value)).toThrow(getRelevantRealm(other.window).TypeError);
  });

  it('retains diagnostics and supports first array access after the owning Document is replaced', async () => {
    const { browser, value, document } = fixture(record({ reasons: [{ reason: 'fetch' }], children: [record()] }));
    const realm = document.env.realm;
    await browser.navigate('https://example.test/replacement');
    expect(document.getNodeNavigable()).toBeNull();
    expect(getRelevantRealm(value)).toBe(realm);
    expect(Object.getPrototypeOf(value.reasons)).toBe(realm.Array.prototype);
    expect(getRelevantRealm(value.children![0]!)).toBe(realm);
    expect(value.reasons![0]!.reason).toBe('fetch');
    expect(Reflect.get(value.toJSON(), 'children')).toBe(value.children);
  });

  it('selects the active top-level history record, independently of the current traversal entry', () => {
    const { document } = fixture();
    const navigable = document.getNodeNavigable()!;
    expect(document.notRestoredReasons).toBeNull();
    const active = record({ id: 'active' });
    navigable.activeSessionHistoryEntry.documentState.notRestoredReasons = active;
    const nextState = DocumentState.create(document);
    nextState.notRestoredReasons = record({ id: 'next' });
    navigable.currentSessionHistoryEntry = document.env.createSessionHistoryEntry(document.url, nextState);
    expect(document.notRestoredReasons).toBe(active);
    navigable.activeSessionHistoryEntry = navigable.currentSessionHistoryEntry;
    expect(document.notRestoredReasons).toBe(nextState.notRestoredReasons);
  });

  it('replaces a previous diagnostic record through the complete top-level builder', () => {
    const { document } = fixture();
    const traversable = document.getNodeNavigable() as TopLevelTraversable;
    const state = traversable.activeSessionHistoryEntry.documentState;
    const previous = state.notRestoredReasons = record({ id: 'previous' });
    expect(traversable.buildNotRestoredReasons()).toBeUndefined();
    expect(state.notRestoredReasons).not.toBe(previous);
    expect(state.notRestoredReasons).toEqual(record({ url: document.url, reasons: [], children: [] }));
  });

  it('returns no Document diagnostics for child navigables or detached Documents', () => {
    const { browser, document } = fixture();
    const detached = unwrap<DocumentImpl>(browser.document.implementation.createHTMLDocument());
    expect(detached.notRestoredReasons).toBeNull();
    const childDocument = fixture().document;
    childDocument.browsingContext = new BrowsingContext();
    const state = DocumentState.create(childDocument);
    state.notRestoredReasons = record({ id: 'child' });
    const child = new Navigable(state, document.getNodeNavigable());
    expect(childDocument.getNodeNavigable()).toBe(child);
    expect(childDocument.notRestoredReasons).toBeNull();
  });

  it('leaves the retired Document without diagnostics and starts replacement history state at null', async () => {
    const { browser, document } = fixture();
    const state = document.getNodeNavigable()!.activeSessionHistoryEntry.documentState;
    state.notRestoredReasons = record({ id: 'retained' });
    await browser.navigate('https://example.test/replacement');
    expect(document.notRestoredReasons).toBeNull();
    expect(state.notRestoredReasons.id).toBe('retained');
    expect(unwrap<DocumentImpl>(browser.document).notRestoredReasons).toBeNull();
  });
});

/** Supply already collected records through real bindings; lifecycle and Navigation Timing are separate producers. */
function fixture(backing = record(), browser = new Browlet({ route: () => '' })) {
  const document = unwrap<DocumentImpl>(browser.document);
  const implementation = new NotRestoredReasonsImpl(backing, document.env);
  const value = getBindingContext(document.env.realm).project(NotRestoredReasonsImpl, implementation) as NotRestoredReasonsPlatform;
  return { browser, document, value };
}

/** Initialize the specified null record fields before a test supplies collected diagnostics. */
function record(fields: Partial<NotRestoredReasons> = {}): NotRestoredReasons {
  return { src: null, id: null, name: null, url: null, reasons: null, children: null, ...fields };
}
