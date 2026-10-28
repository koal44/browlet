/* eslint-disable @typescript-eslint/unbound-method -- Invoke the original IDL getters with explicit receivers. */
import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

describe('Window foundations', () => {
  it('declares frames as a replaceable alias of the relevant realm global-this value', () => {
    const browser = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browser.window);
    const global = realm.globalObject;
    const descriptor = Object.getOwnPropertyDescriptor(global, 'frames');

    expect(typeof descriptor?.get).toBe('function');
    expect(typeof descriptor?.set).toBe('function');
    expect(descriptor).toMatchObject({ configurable: true, enumerable: true });
    expect(Reflect.get(global, 'frames')).toBe(realm.globalThis);
    Reflect.set(global, 'frames', 'replacement');
    expect(Reflect.get(global, 'frames')).toBe('replacement');
    expect(Reflect.apply(descriptor!.get!, global, [])).toBe(realm.globalThis);
  });

  it.each(['self', 'frames'] as const)('does not resurrect a deleted %s alias', (name) => {
    const browser = new Browlet({ route: () => '' });
    expect(Reflect.deleteProperty(browser.window, name)).toBe(true);
    expect(Reflect.has(browser.window, name)).toBe(false);
    expect(Reflect.get(browser.window, name)).toBeUndefined();
  });

  it('permits a borrowed frames getter across origins but rejects the replaceable setter', () => {
    const caller = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    const descriptor = Object.getOwnPropertyDescriptor(caller.window, 'frames')!;

    expect(Reflect.apply(descriptor.get!, target.window, [])).toBe(target.window);
    expect(() => { Reflect.apply(descriptor.set!, target.window, ['replacement']); })
      .toThrow(caller.window.DOMException);
    expect(target.window.frames).toBe(target.window);
  });

  it.each(['window', 'self', 'frames'] as const)(
    'retains %s after the associated Document loses its browsing context', (name) => {
      const browser = new Browlet({ route: () => '' });
      const document = unwrap<DocumentImpl>(browser.document);
      const realm = getRelevantRealm(browser.document);
      const getter = Object.getOwnPropertyDescriptor(realm.globalObject, name)?.get;
      expect(typeof getter).toBe('function');
      document.browsingContext = null;

      expect(Reflect.apply(getter!, realm.globalObject, [])).toBe(realm.globalThis);
      expect(Reflect.get(realm.globalObject, 'document')).toBe(browser.document);
      expect(browser.document.defaultView).toBeNull();
      const window = realm.windowImplementation;
      expect(window.browsingContext).toBeNull();
      expect(window.navigable).toBeNull();
    },
  );

  it('exposes HTMLDocument as a writable, configurable, non-enumerable alias of Document', () => {
    const browser = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const global = getRelevantRealm(browser.window).globalObject;
    const Document = browser.window.Document;
    expect(Reflect.get(global, 'HTMLDocument')).toBe(Document);
    expect(Object.getOwnPropertyDescriptor(global, 'HTMLDocument')).toEqual({
      value: Document, writable: true, configurable: true, enumerable: false,
    });
    expect(Reflect.get(other.window, 'HTMLDocument')).toBe(other.window.Document);
    expect(other.window.Document).not.toBe(Document);
  });
});
