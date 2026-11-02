import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext, Navigable, createDocumentState } from '../../../../src/browlet/browsing/navigation/index';
import { OpenerPolicy } from '../../../../src/browlet/browsing/policy/coop';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/index';
import { CrossOriginObjectBinding } from '../../../../src/browlet/integration/web-idl/bindings/cross-origin';
import { getBindingContext, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

// Caller selection is explicit; these exercise Delete, not automatic trap interception.
describe('Caller-bound WindowProxy Delete', () => {
  it('deletes configurable data and accessor properties without invoking their functions', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const getter = vi.fn(() => 1);
    const setter = vi.fn();
    const symbol = Symbol('data');
    Object.defineProperties(handle.associatedWindow, {
      data: { value: 1, configurable: true },
      accessor: { get: getter, set: setter, configurable: true },
      [symbol]: { value: 2, configurable: true },
    });
    for (const key of ['data', 'accessor', symbol]) {
      expect(binding.deleteWindowProxyProperty(key, handle)).toBe(true);
      expect(Reflect.getOwnPropertyDescriptor(handle.associatedWindow, key)).toBeUndefined();
    }
    expect(getter).not.toHaveBeenCalled();
    expect(setter).not.toHaveBeenCalled();
  });

  it('preserves nonconfigurable properties and returns false', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    Object.defineProperty(handle.associatedWindow, 'fixed', { value: 42 });
    for (const key of ['fixed', 'window', 'document', 'location']) {
      const original = Reflect.getOwnPropertyDescriptor(handle.associatedWindow, key);
      expect(original?.configurable).toBe(false);
      expect(binding.deleteWindowProxyProperty(key, handle)).toBe(false);
      expect(Reflect.getOwnPropertyDescriptor(handle.associatedWindow, key)).toEqual(original);
    }
  });

  it('returns true for absent own properties without deleting inherited or named child properties', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const getter = vi.fn(() => 42);
    const parent = Reflect.getPrototypeOf(handle.associatedWindow)!;
    Object.defineProperty(parent, 'inherited', { get: getter, configurable: true });
    const child = createChild(targetDocument, 'namedChild');
    for (const key of ['missing', 'inherited', 'namedChild']) {
      expect(binding.deleteWindowProxyProperty(key, handle)).toBe(true);
    }
    expect(Reflect.getOwnPropertyDescriptor(parent, 'inherited')?.get).toBe(getter);
    expect(getter).not.toHaveBeenCalled();
    expect(binding.getWindowProxy('namedChild', handle.platform, handle)).toBe(child.navigable.activeWindowProxy.platform);
  });

  it('rejects a present child index even though its descriptor is configurable', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const child = createChild(targetDocument, 'child');
    const descriptor = binding.getWindowProxyOwnProperty('0', handle);
    expect(descriptor?.value).toBe(child.navigable.activeWindowProxy.platform);
    expect(descriptor?.configurable).toBe(true);
    expect(binding.deleteWindowProxyProperty('0', handle)).toBe(false);
    expect(binding.getWindowProxyOwnProperty('0', handle)).toEqual(descriptor);
    expect(targetDocument.getDocumentTreeChildNavigables()).toEqual([child.navigable]);
  });

  it('rechecks child presence after retained associations change or containers leave the document', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const child = createChild(targetDocument, 'child');
    expect(binding.deleteWindowProxyProperty('0', handle)).toBe(false);
    child.container.contentNavigable = null;
    expect(binding.deleteWindowProxyProperty('0', handle)).toBe(true);
    child.container.contentNavigable = child.navigable;
    expect(binding.deleteWindowProxyProperty('0', handle)).toBe(false);
    targetDocument.body!.removeChild(child.container);
    expect(binding.deleteWindowProxyProperty('0', handle)).toBe(true);
  });

  it.each([false, true])('leaves ordinary numeric expandos untouched when configurable is %s', (configurable) => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    createChild(targetDocument, 'child');
    // Direct stock-VM access and unfinished traps can still leave numeric properties on Window.
    const original = { value: 'numeric expando', configurable, enumerable: true, writable: true };
    for (const key of ['0', '1', '4294967294']) {
      Object.defineProperty(handle.associatedWindow, key, original);
      expect(binding.deleteWindowProxyProperty(key, handle)).toBe(key !== '0');
      expect(Reflect.getOwnPropertyDescriptor(handle.associatedWindow, key)).toEqual(original);
    }
  });

  it('uses ordinary deletion for non-index numeric strings and symbols', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    for (const key of ['-0', '01', '1.0', '4294967295', '4294967296', Symbol('index')]) {
      Object.defineProperty(handle.associatedWindow, key, { value: 1, configurable: true });
      expect(binding.deleteWindowProxyProperty(key, handle)).toBe(true);
      expect(Reflect.getOwnPropertyDescriptor(handle.associatedWindow, key)).toBeUndefined();
    }
  });

  it.each([
    '0', '1', '4294967294', 'self', 'location', 'postMessage', 'then', Symbol.toStringTag,
    Symbol.hasInstance, Symbol.isConcatSpreadable, 'namedChild', 'ordinary', 'missing', Symbol('private'),
  ])('rejects every foreign deletion of %s in the caller realm', (key) => {
    const { targetDocument, binding, handle, context, targetContext } = createPair();
    const child = createChild(targetDocument, 'namedChild');
    const getter = vi.fn(() => 42);
    Object.defineProperty(handle.associatedWindow, 'ordinary', { get: getter, configurable: true });
    const original = Reflect.getOwnPropertyDescriptor(handle.associatedWindow, key);
    let failure: unknown;
    try { binding.deleteWindowProxyProperty(key, handle); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(context.DOMException);
    expect(failure).not.toBeInstanceOf(targetContext.DOMException);
    expect(failure).toHaveProperty('name', 'SecurityError');
    expect(Reflect.getOwnPropertyDescriptor(handle.associatedWindow, key)).toEqual(original);
    expect(targetDocument.getDocumentTreeChildNavigables()).toEqual([child.navigable]);
    expect(getter).not.toHaveBeenCalled();
  });

  it('uses live same-origin-domain before deciding whether an index is present', () => {
    const { callerDocument, targetDocument, binding, handle, context } = createPair();
    const callerOrigin = obtainURLOrigin(parseURL('https://caller.example.test/').url!);
    const targetOrigin = obtainURLOrigin(parseURL('https://target.example.test/').url!);
    if (callerOrigin.kind !== 'tuple' || targetOrigin.kind !== 'tuple') throw new Error('Expected tuple origins');
    callerDocument.origin = callerOrigin;
    targetDocument.origin = targetOrigin;
    createChild(targetDocument, 'child');
    Object.defineProperty(handle.associatedWindow, 'ordinary', { value: 1, configurable: true });
    const domain = { kind: 'domain', value: 'example.test' } as const;
    callerOrigin.domain = domain;
    expect(() => binding.deleteWindowProxyProperty('ordinary', handle)).toThrow(context.DOMException);
    expect(Reflect.get(handle.associatedWindow, 'ordinary')).toBe(1);
    targetOrigin.domain = domain;
    expect(binding.deleteWindowProxyProperty('ordinary', handle)).toBe(true);
    expect(binding.deleteWindowProxyProperty('0', handle)).toBe(false);
    expect(binding.deleteWindowProxyProperty('1', handle)).toBe(true);
    callerDocument.origin = createOpaqueOrigin();
    expect(() => binding.deleteWindowProxyProperty('1', handle)).toThrow(context.DOMException);
  });

  it('rechecks the current Window and origin after navigation without deleting from the old Window', async () => {
    const { callerDocument, targetDocument, target, binding, handle, context } = createPair();
    callerDocument.origin = targetDocument.origin;
    const oldWindow = handle.associatedWindow;
    Object.defineProperty(oldWindow, 'ordinary', { value: 'old', configurable: true });
    const proxy = handle.platform;
    await target.navigate('https://replacement.example.test/');
    const currentWindow = handle.associatedWindow;
    Object.defineProperty(currentWindow, 'ordinary', { value: 'current', configurable: true });
    expect(handle.platform).toBe(proxy);
    expect(currentWindow === oldWindow).toBe(false);
    expect(() => binding.deleteWindowProxyProperty('ordinary', handle)).toThrow(context.DOMException);
    expect(Reflect.get(currentWindow, 'ordinary')).toBe('current');
    callerDocument.origin = unwrap<DocumentImpl>(target.document).origin;
    expect(binding.deleteWindowProxyProperty('ordinary', handle)).toBe(true);
    expect(Object.hasOwn(currentWindow, 'ordinary')).toBe(false);
    expect(Reflect.get(oldWindow, 'ordinary')).toBe('old');
  });

  it('does not run the Get/Set COOP reporting check for either origin branch', () => {
    const { callerDocument, targetDocument, binding, handle, context } = createPair();
    targetDocument.browsingContext!.virtualBrowsingContextGroupID++;
    const reports = vi.spyOn(OpenerPolicy, 'queueAccessReports');
    expect(() => binding.deleteWindowProxyProperty('self', handle)).toThrow(context.DOMException);
    callerDocument.origin = targetDocument.origin;
    expect(binding.deleteWindowProxyProperty('self', handle)).toBe(true);
    expect(reports).not.toHaveBeenCalled();
  });
});

function createPair() {
  const caller = new Browlet({ route: () => '' });
  const target = new Browlet({ route: () => '' });
  const callerDocument = unwrap<DocumentImpl>(caller.document);
  const targetDocument = unwrap<DocumentImpl>(target.document);
  targetDocument.browsingContext!.virtualBrowsingContextGroupID = callerDocument.browsingContext!.virtualBrowsingContextGroupID;
  const context = getBindingContext(callerDocument.env.realm);
  return {
    target, callerDocument, targetDocument, context,
    targetContext: getBindingContext(targetDocument.env.realm),
    handle: targetDocument.browsingContext!.windowProxy,
    binding: new CrossOriginObjectBinding(context),
  };
}

function createChild(document: DocumentImpl, name: string) {
  const container = document.createElement('iframe') as HTMLIFrameElementImpl;
  const [, childDocument] = BrowsingContext.createTopLevel(document.env.userAgent);
  childDocument.origin = document.origin;
  const state = createDocumentState(childDocument);
  state.navigableTargetName = name;
  const navigable = new Navigable(state, document.getNodeNavigable());
  // Automatic child creation is unfinished; connect the retained implementation association.
  container.contentNavigable = navigable;
  document.body!.appendChild(container);
  return { container, navigable };
}
