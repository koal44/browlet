import { describe, expect, it } from 'vitest';

import { browletBindings, projectWindow } from '../../../../src/browlet/bindings';
import { BrowsingContext } from '../../../../src/browlet/browsing/browsing-context';
import { WindowImpl } from '../../../../src/browlet/browsing/window/window';
import { adoptNativeWindowProxy } from '../../../../src/browlet/browsing/window/window-proxy';
import {
  createDocument, createProjectedDOMNodeFactory, DocumentImpl,
} from '../../../../src/browlet/dom/nodes/document';
import { WindowAgent } from '../../../../src/browlet/scripting/agents';
import { Realm } from '../../../../src/browlet/scripting/realm';
import { setupWindowEnvironmentSettingsObject } from '../../../../src/browlet/scripting/environment';
import { parseURL } from '../../../../src/url/url';
import { createOpaqueOrigin } from '../../../../src/url/origin';

// This opt-in allocation API belongs to the addon; plain Node and the older
// source-patched VM do not expose it. The normal browser bootstrap is separate.
describe.skipIf(process.env.BROWLET_NODE_ADDON === undefined)('native Window allocation', () => {
  it('binds real Window and EventTarget members without changing WindowImpl identity', () => {
    const fixture = createNativeWindow();
    const { realm, window, platformWindow, document, context } = fixture;
    const proxy = context.windowProxy;
    expect(Object.getPrototypeOf(window)).toBe(WindowImpl.prototype);
    expect(platformWindow).not.toBe(window);
    expect(browletBindings.getImplementation(platformWindow)).toBe(window);
    expect(realm.evaluate('this === window && window === globalThis', 'identity.js')).toBe(true);
    expect(realm.evaluate('this.document === document', 'document.js')).toBe(true);
    expect(realm.evaluate('Object.getPrototypeOf(this) === Window.prototype', 'prototype.js')).toBe(true);
    expect(realm.evaluate('Object.hasOwn(this, "document")', 'own-document.js')).toBe(true);
    expect(realm.evaluate('Object.prototype.toString.call(this)', 'tag.js')).toBe('[object Window]');
    expect(browletBindings.getImplementation(proxy.document)).toBe(document);
    expect(realm.evaluate(`
      globalThis.trace = [];
      this.addEventListener('probe', event => trace.push(event.type));
      this.dispatchEvent(new Event('probe'));
      trace.join(',');
    `, 'event-target.js')).toBe('probe');
    expect(realm.evaluate(`
      Reflect.setPrototypeOf(this, Object.getPrototypeOf(this)) &&
      !Reflect.setPrototypeOf(this, {}) &&
      !Reflect.setPrototypeOf(Window.prototype, {}) &&
      Object.isExtensible(this)
    `, 'immutability.js')).toBe(true);
  });

  it('retains per-Window records when the native proxy is reused', () => {
    const first = createNativeWindow();
    const proxy = first.context.windowProxy;
    // Borrow the Web IDL getter deliberately to exercise receiver resolution.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const firstDocumentGetter = Object.getOwnPropertyDescriptor(first.platformWindow, 'document')?.get as
      ((this: object) => object) | undefined;
    if (!firstDocumentGetter) throw new Error('Window document getter missing');
    const oldClosure = first.realm.evaluate('const original = 42; () => original', 'old.js') as () => number;
    const oldDocument = first.realm.evaluate('() => document', 'old-document.js') as () => Document;
    const oldState = first.realm.evaluate(`
      var pageState = 1;
      () => [++pageState, globalThis];
    `, 'old-state.js') as () => [number, object];
    first.realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(first.realm.detachGlobal()).toBe(proxy);
    const second = createNativeWindow(first);
    expect(second.context.windowProxy).toBe(proxy);
    expect(second.platformWindow).not.toBe(first.platformWindow);
    expect(second.realm.intrinsics.object).not.toBe(first.realm.intrinsics.object);
    expect(oldClosure()).toBe(42);
    expect(browletBindings.getImplementation(oldDocument()) === first.document).toBe(true);
    expect(oldState()).toEqual([2, proxy]);
    expect(second.realm.evaluate('typeof pageState', 'new-state.js')).toBe('undefined');
    expect(browletBindings.getImplementation(first.platformWindow)).toBe(first.window);
    expect(browletBindings.getImplementation(second.platformWindow)).toBe(second.window);
    expect(browletBindings.getImplementation(Reflect.apply(firstDocumentGetter, proxy, [])))
      .toBe(second.document);
    expect(browletBindings.getImplementation(Reflect.apply(firstDocumentGetter, first.platformWindow, [])))
      .toBe(first.document);
    expect(second.realm.evaluate('this === window && !Reflect.setPrototypeOf(this, {})', 'new.js'))
      .toBe(true);
  });

  it('preserves global declarations, descriptors, deletion and missing-name errors', () => {
    const { realm, platformWindow } = createNativeWindow();
    expect(realm.evaluate(`
      var declared = 7;
      function readDeclared() { return declared; }
      globalThis[3] = 'indexed';
      globalThis[Symbol.for('probe')] = 'symbol';
      [this.declared, readDeclared(), this[3], this[Symbol.for('probe')]];
    `, 'properties.js')).toEqual([7, 7, 'indexed', 'symbol']);
    expect(Reflect.get(platformWindow, 'declared')).toBe(7);
    expect(Reflect.get(platformWindow, '3')).toBe('indexed');
    expect(realm.evaluate(`
      Object.defineProperty(this, 'fixed', {value: 9});
      [Reflect.set(this, 'fixed', 1), Reflect.deleteProperty(this, 'fixed'),
       Reflect.defineProperty(this, 'fixed', {value: 1}), this.fixed];
    `, 'fixed.js')).toEqual([false, false, false, 9]);
    expect(realm.evaluate(`
      const keys = Reflect.ownKeys(this);
      keys.includes('document') && keys.includes('3') &&
        keys.includes(Symbol.for('probe')) && new Set(keys).size === keys.length;
    `, 'keys.js')).toBe(true);
    expect(realm.evaluate('delete this.JSON; typeof JSON', 'delete.js')).toBe('undefined');
    expect(Reflect.has(platformWindow, 'JSON')).toBe(false);
    expect(realm.evaluate('typeof missingGlobal', 'typeof.js')).toBe('undefined');
    expect(() => realm.evaluate('missingGlobal', 'missing.js')).toThrow('missingGlobal is not defined');
    expect(() => realm.evaluate('"use strict"; this.fixed = 1', 'strict-set.js')).toThrow();
    expect(() => realm.evaluate('"use strict"; delete this.fixed', 'strict-delete.js')).toThrow();
    expect(realm.evaluate(`
      const descriptor = {__proto__: null, value: 12};
      Object.defineProperty(Object.prototype, 'get', {
        configurable: true,
        get() { throw new Error('descriptor inherited an author getter'); }
      });
      try {
        Object.defineProperty(this, 'transported', descriptor);
        this.transported;
      } finally { delete Object.prototype.get; }
    `, 'descriptor-prototype.js')).toBe(12);
  });

  it('uses Web IDL named properties through the native prototype', () => {
    const { realm } = createNativeWindow();
    expect(realm.evaluate(`
      const root = document.createElement('html');
      document.appendChild(root);
      const element = document.createElement('div');
      element.setAttribute('id', 'namedProbe');
      root.appendChild(element);
      window.namedProbe === element && namedProbe === element;
    `, 'named.js')).toBe(true);
    expect(realm.evaluate(`
      const names = Object.getPrototypeOf(Window.prototype);
      ['namedProbe' in window, Object.hasOwn(window, 'namedProbe'),
       Object.getOwnPropertyDescriptor(names, 'namedProbe').value === namedProbe,
       Reflect.ownKeys(names).includes('namedProbe'),
       Reflect.defineProperty(names, 'extra', {value: 1}),
       Reflect.deleteProperty(names, 'namedProbe'), Reflect.preventExtensions(names)];
    `, 'named-descriptor.js')).toEqual([true, false, true, false, false, false, false]);
    expect(realm.evaluate('Reflect.ownKeys(names)', 'named-keys.js')).toEqual([Symbol.toStringTag]);
    expect(realm.evaluate(`
      window.namedProbe = 42;
      const shadowed = namedProbe === 42 && Object.hasOwn(window, 'namedProbe');
      delete window.namedProbe;
      shadowed && namedProbe === element;
    `, 'named-shadowing.js')).toBe(true);
  });
});

function createNativeWindow(previous?: NativeWindow): NativeWindow {
  const agent = previous?.realm.agent ?? new WindowAgent();
  const realm = new Realm({
    agent,
    reuseGlobalProxyFrom: previous?.realm,
    // Window.prototype -> Window named-properties object ->
    // EventTarget.prototype -> Object.prototype.
    globalPrototypeChain: ['immutable', 'delegated', 'immutable'],
  });
  const chain = realm.globalPrototypeChain;
  if (!chain || chain.length !== 3) throw new Error('Native global allocation missing');
  const object = realm.allocatedGlobalObject;
  const [windowPrototype, namedProperties, eventTargetPrototype] = chain;
  if (!object || !windowPrototype || !namedProperties || !eventTargetPrototype) {
    throw new Error('Incomplete native prototype chain');
  }
  const proxy = adoptNativeWindowProxy(realm.globalThis);
  const context = previous?.context ?? new BrowsingContext(proxy);
  const bindings = browletBindings.register(realm);
  const window = new WindowImpl(new URL('https://example.test/'));
  const platformWindow = projectWindow(bindings, window, {
    object,
    prototypes: new Map([
      ['Window', windowPrototype],
      ['EventTarget', eventTargetPrototype],
    ]),
    namedProperties: {
      object: namedProperties,
      setDelegate: (delegate) => { realm.setPropertyDelegate(namedProperties, delegate); },
    },
  });
  const document = createDocument({
    nodeFactory: createProjectedDOMNodeFactory(bindings.context),
  });
  DocumentImpl.setBrowsingContext(document, context);
  WindowImpl.setAssociatedDocument(window, document);
  Realm.setGlobalObjects(realm, platformWindow, proxy, window);
  const url = parseURL('https://example.test/').url;
  if (!url) throw new Error('Fixture URL missing');
  setupWindowEnvironmentSettingsObject(url, { realm }, null, url, createOpaqueOrigin(), bindings);
  browletBindings.retargetWindowProxy(proxy, window);
  bindings.install(platformWindow);
  return { realm, window, platformWindow, document, context };
}

type NativeWindow = {
  realm: Realm;
  window: WindowImpl;
  platformWindow: Window;
  document: DocumentImpl;
  context: BrowsingContext;
};
