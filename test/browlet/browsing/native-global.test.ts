import { createManualEventLoop } from '../../support/browlet-agent';
import { describe, expect, it } from 'vitest';
import { itPassesWith } from '../../test-runtime';

import { unwrap, project } from '../../support/browlet-binding';
import { BrowsingContext } from '../../../src/browlet/browsing/navigation/browsing-context';
import { WindowImpl } from '../../../src/browlet/browsing/window/window';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { AgentCluster, WindowAgent } from '../../../src/browlet/scripting/agents';
import type { WindowRealm } from '../../../src/browlet/scripting/realm';
import { createWindowEnvironment } from '../../../src/browlet/bindings';
import { UserAgent } from '../../../src/browlet/user-agent';
import { parseURL } from '../../../src/url/url';
import { createOpaqueOrigin } from '../../../src/url/origin';
import type { StampedPlatformObject } from '../../../src/web-idl/index';

// Native allocation belongs to the addon; plain Node has no equivalent API.
describe('Window global allocation', () => {
  itPassesWith('nativeGlobals')('binds real Window and EventTarget members without changing WindowImpl identity', () => {
    const fixture = createNativeWindow();
    const { realm, window, platformWindow, document, context } = fixture;
    const proxy = context.windowProxy.platform;
    expect(Object.getPrototypeOf(window)).toBe(WindowImpl.prototype);
    expect(platformWindow).not.toBe(window);
    expect(unwrap(platformWindow)).toBe(window);
    const { object, prototypeChain } = realm.globalAllocation;
    expect(object).toBe(platformWindow);
    expect(object).toBe(realm.globalObject);
    const windowPrototype = Object.getPrototypeOf(platformWindow) as object;
    const namedProperties = Object.getPrototypeOf(windowPrototype) as object;
    const eventTargetPrototype = Object.getPrototypeOf(namedProperties) as object;
    expect(prototypeChain).toHaveLength(3);
    expect(prototypeChain[0]).toBe(windowPrototype);
    expect(prototypeChain[1]).toBe(namedProperties);
    expect(prototypeChain[2]).toBe(eventTargetPrototype);
    expect(Object.getPrototypeOf(eventTargetPrototype)).toBe(realm.objectPrototype);
    expect(realm.evaluate('this === window && window === globalThis', 'identity.js')).toBe(true);
    expect(realm.evaluate('this.document === document', 'document.js')).toBe(true);
    expect(realm.evaluate('Object.getPrototypeOf(this) === Window.prototype', 'prototype.js')).toBe(true);
    expect(realm.evaluate('Object.hasOwn(this, "document")', 'own-document.js')).toBe(true);
    expect(realm.evaluate('Object.prototype.toString.call(this)', 'tag.js')).toBe('[object Window]');
    expect(unwrap(proxy.document)).toBe(document);
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

  itPassesWith('nativeGlobals')('retains per-Window records when the native proxy is reused', () => {
    const first = createNativeWindow();
    const handle = first.context.windowProxy;
    const proxy = handle.platform;
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
    const second = createNativeWindow(first);
    expect(second.context.windowProxy).toBe(handle);
    expect(second.realm.windowProxy).toBe(handle);
    expect(second.realm.globalThis).toBe(proxy);
    expect(second.platformWindow).not.toBe(first.platformWindow);
    expect(second.realm.Object).not.toBe(first.realm.Object);
    expect(oldClosure()).toBe(42);
    expect(unwrap(oldDocument())).toBe(first.document);
    expect(oldState()).toEqual([2, proxy]);
    expect(second.realm.evaluate('typeof pageState', 'new-state.js')).toBe('undefined');
    expect(unwrap(first.platformWindow)).toBe(first.window);
    expect(unwrap(second.platformWindow)).toBe(second.window);
    expect(unwrap(Reflect.apply(firstDocumentGetter, proxy, [])))
      .toBe(second.document);
    expect(unwrap(Reflect.apply(firstDocumentGetter, first.platformWindow, [])))
      .toBe(first.document);
    expect(second.realm.evaluate('this === window && !Reflect.setPrototypeOf(this, {})', 'new.js'))
      .toBe(true);
  });

  itPassesWith('nativeGlobals')('preserves global declarations, descriptors, deletion and missing-name errors', () => {
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

  it('uses Web IDL named properties through the Window prototype', () => {
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
  const agent = previous?.agent ?? new WindowAgent(createManualEventLoop());
  if (!previous) {
    const cluster = new AgentCluster();
    cluster.isOriginKeyed = true;
    cluster.add(agent);
  }
  const creationURL = parseURL('https://example.test/').url!;
  const origin = createOpaqueOrigin();
  const env = createWindowEnvironment({
    agent, userAgent: previous?.realm.env.userAgent ?? new UserAgent(),
    creationURL, origin, parent: null,
    topLevelCreationURL: creationURL, topLevelOrigin: origin, previousRealm: previous?.realm,
  });
  const { window, realm } = env;
  const proxy = realm.windowProxy;
  const context = previous?.context ?? new BrowsingContext(proxy);
  const platformWindow = project(window) as StampedPlatformObject<Window>;
  const document = realm.env.createDocument();
  document.browsingContext = context;
  window.setAssociatedDocument(document);
  proxy.setAssociatedWindow(window.env.realm.globalObject);
  return { agent, realm, window, platformWindow, document, context };
}

type NativeWindow = {
  agent: WindowAgent;
  realm: WindowRealm;
  window: WindowImpl;
  platformWindow: Window;
  document: DocumentImpl;
  context: BrowsingContext;
};
