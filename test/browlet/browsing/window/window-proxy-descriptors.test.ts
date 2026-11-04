/* eslint-disable @typescript-eslint/unbound-method -- Inspect IDL getter identities and invoke them with explicit receivers. */
import { describe, expect, it } from 'vitest';

import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext, Navigable, DocumentState } from '../../../../src/browlet/browsing/navigation/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/index';
import { CrossOriginObjectBinding } from '../../../../src/browlet/integration/web-idl/bindings/cross-origin';
import { getBindingContext, unwrap } from '../../../support/browlet-binding';

// The real caller binding is explicit until WindowProxy traps can select it automatically.
describe('Caller-bound WindowProxy own descriptors', () => {
  it('preserves ordinary same-origin descriptors without invoking author accessors', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const getter = () => { throw new Error('Descriptor lookup must not call the getter'); };
    const setter = () => { throw new Error('Descriptor lookup must not call the setter'); };
    const key = Symbol('own');
    Object.defineProperties(handle.associatedWindow, {
      fixed: { value: 42, writable: false, enumerable: true, configurable: false },
      [key]: { get: getter, set: setter, enumerable: false, configurable: true },
    });

    expect(binding.getWindowProxyOwnProperty('fixed', handle)).toEqual({
      value: 42, writable: false, enumerable: true, configurable: false,
    });
    expect(binding.getWindowProxyOwnProperty(key, handle)).toEqual({
      get: getter, set: setter, enumerable: false, configurable: true,
    });
    expect(binding.getWindowProxyOwnProperty('missing', handle)).toBeUndefined();
    expect(binding.getWindowProxyOwnProperty('toString', handle)).toBeUndefined();
  });

  it('keeps same-origin named properties inherited rather than turning them into own properties', () => {
    const { callerDocument, targetDocument, target, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const child = createChild(targetDocument, 'childName');
    targetDocument.body!.appendChild(child.container);
    const element = targetDocument.createElement('div');
    element.id = 'elementID';
    targetDocument.body!.appendChild(element);

    expect(Reflect.has(target.window, 'childName')).toBe(true);
    expect(Reflect.has(target.window, 'elementID')).toBe(true);
    expect(binding.getWindowProxyOwnProperty('childName', handle)).toBeUndefined();
    expect(binding.getWindowProxyOwnProperty('elementID', handle)).toBeUndefined();
  });

  it.each([false, true])('exposes valid child indices when same-origin is %s', (sameOrigin) => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    if (sameOrigin) callerDocument.origin = targetDocument.origin;
    const child = createChild(targetDocument, 'childName');
    child.document.origin = createOpaqueOrigin();
    targetDocument.body!.appendChild(child.container);
    Object.defineProperty(handle.associatedWindow, '0', { value: 'ordinary shadow', configurable: true });

    expect(binding.getWindowProxyOwnProperty('0', handle)).toEqual({
      value: child.navigable.activeWindowProxy.platform, writable: false, enumerable: true, configurable: true,
    });
  });

  it.each(['0', '4294967294'])('ignores ordinary properties at the absent child index %s', (key) => {
    const { callerDocument, targetDocument, binding, handle, context } = createPair();
    Object.defineProperty(handle.associatedWindow, key, { value: 'hidden numeric property', configurable: true });
    expect(() => binding.getWindowProxyOwnProperty(key, handle)).toThrow(context.DOMException);
    expect(() => binding.getWindowProxyOwnProperty(key, handle)).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    callerDocument.origin = targetDocument.origin;
    expect(binding.getWindowProxyOwnProperty(key, handle)).toBeUndefined();
  });

  it.each(['-0', '00', '01', '1.0', '4294967295'])('treats %s as an ordinary name rather than an index', (key) => {
    const { callerDocument, targetDocument, binding, handle, context } = createPair();
    Object.defineProperty(handle.associatedWindow, key, { value: key, configurable: true });
    expect(() => binding.getWindowProxyOwnProperty(key, handle)).toThrow(context.DOMException);
    callerDocument.origin = targetDocument.origin;
    expect(binding.getWindowProxyOwnProperty(key, handle)).toEqual({
      value: key, writable: false, enumerable: false, configurable: true,
    });
  });

  it.each(['document', 'fetch', 'privateValue', 'toString', Symbol.iterator, Symbol('then')])(
    'rejects foreign descriptor access to %s in the caller realm', (key) => {
      const { binding, handle, context, targetContext } = createPair();
      if (key === 'privateValue') Object.defineProperty(handle.associatedWindow, key, { value: 'secret' });
      let failure: unknown;
      try { binding.getWindowProxyOwnProperty(key, handle); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(context.DOMException);
      expect(failure).not.toBeInstanceOf(targetContext.DOMException);
      expect(failure).toHaveProperty('name', 'SecurityError');
    },
  );

  it.each(['then', Symbol.toStringTag, Symbol.hasInstance, Symbol.isConcatSpreadable])(
    'uses the undefined-valued foreign fallback for %s despite an author property', (key) => {
      const { binding, handle } = createPair();
      Object.defineProperty(handle.associatedWindow, key, { value: 'author value', configurable: true });
      expect(binding.getWindowProxyOwnProperty(key, handle)).toEqual({
        value: undefined, writable: false, enumerable: false, configurable: true,
      });
    },
  );

  it('uses cached caller-realm IDL descriptors ahead of author replacements and child names', () => {
    const { targetDocument, target, binding, handle, context } = createPair();
    targetDocument.body!.appendChild(createChild(targetDocument, 'self').container);
    const authorGetter = () => { throw new Error('Author accessor must not run'); };
    Object.defineProperty(handle.associatedWindow, 'self', { get: authorGetter });
    const descriptor = binding.getWindowProxyOwnProperty('self', handle)!;
    expect(descriptor).toMatchObject({ set: undefined, enumerable: false, configurable: true });
    expect(descriptor.get).toBeInstanceOf(context.realm.Function);
    expect(descriptor.get).not.toBe(authorGetter);
    expect(Reflect.apply(descriptor.get!, target.window, [])).toBe(target.window);
    expect(binding.getWindowProxyOwnProperty('self', handle)).toBe(descriptor);

    const method = binding.getWindowProxyOwnProperty('postMessage', handle)!;
    expect(method).toMatchObject({ writable: false, enumerable: false, configurable: true });
    expect(method.value).toBeInstanceOf(context.realm.Function);
    expect(binding.getWindowProxyOwnProperty('postMessage', handle)).toBe(method);
  });

  it('returns eligible named children ahead of ordinary properties with non-enumerable descriptors', () => {
    const { targetDocument, binding, handle } = createPair();
    const child = createChild(targetDocument, 'childName');
    targetDocument.body!.appendChild(child.container);
    Object.defineProperty(handle.associatedWindow, 'childName', { value: 'shadow', configurable: true });
    expect(binding.getWindowProxyOwnProperty('childName', handle)).toEqual({
      value: child.navigable.activeWindowProxy.platform, writable: false, enumerable: false, configurable: true,
    });
  });

  it('resolves a child named then before applying the fallback and drops it after removal', () => {
    const { targetDocument, binding, handle } = createPair();
    const child = createChild(targetDocument, 'then');
    targetDocument.body!.appendChild(child.container);
    expect(binding.getWindowProxyOwnProperty('then', handle)?.value).toBe(child.navigable.activeWindowProxy.platform);
    child.container.remove();
    expect(binding.getWindowProxyOwnProperty('then', handle)).toEqual({
      value: undefined, writable: false, enumerable: false, configurable: true,
    });
  });

  it('does not expose element names or IDs, including IDs that also match a foreign child', () => {
    const { targetDocument, binding, handle, context } = createPair();
    const child = createChild(targetDocument, 'indirect');
    child.document.origin = createOpaqueOrigin();
    const element = targetDocument.createElement('div');
    element.id = 'indirect';
    const form = targetDocument.createElement('form');
    form.setAttribute('name', 'formName');
    targetDocument.body!.append(child.container, element, form);

    expect(() => binding.getWindowProxyOwnProperty('indirect', handle)).toThrow(context.DOMException);
    expect(() => binding.getWindowProxyOwnProperty('formName', handle)).toThrow(context.DOMException);
  });

  it('deduplicates target names before filtering child origins and rechecks live tree order', () => {
    const { targetDocument, binding, handle, context } = createPair();
    const first = createChild(targetDocument, 'duplicate');
    first.document.origin = createOpaqueOrigin();
    first.container.setAttribute('name', 'duplicate');
    const second = createChild(targetDocument, 'duplicate');
    targetDocument.body!.append(first.container, second.container);
    expect(() => binding.getWindowProxyOwnProperty('duplicate', handle)).toThrow(context.DOMException);
    targetDocument.body!.appendChild(first.container);
    expect(binding.getWindowProxyOwnProperty('duplicate', handle)?.value).toBe(second.navigable.activeWindowProxy.platform);
    second.container.remove();
    expect(() => binding.getWindowProxyOwnProperty('duplicate', handle)).toThrow(context.DOMException);
  });

  it('rechecks child names, exact origins, and content-navigable associations without caching descriptors', () => {
    const { targetDocument, binding, handle, context } = createPair();
    const child = createChild(targetDocument, 'before');
    targetDocument.body!.appendChild(child.container);
    expect(binding.getWindowProxyOwnProperty('before', handle)?.value).toBe(child.navigable.activeWindowProxy.platform);
    child.navigable.activeSessionHistoryEntry.documentState.navigableTargetName = 'after';
    expect(() => binding.getWindowProxyOwnProperty('before', handle)).toThrow(context.DOMException);
    expect(binding.getWindowProxyOwnProperty('after', handle)?.value).toBe(child.navigable.activeWindowProxy.platform);
    child.document.origin = createOpaqueOrigin();
    expect(() => binding.getWindowProxyOwnProperty('after', handle)).toThrow(context.DOMException);
    child.document.origin = targetDocument.origin;
    child.container.contentNavigable = null;
    expect(() => binding.getWindowProxyOwnProperty('after', handle)).toThrow(context.DOMException);
  });

  it('uses live same-origin-domain for callers but exact same-origin for named children', () => {
    const { callerDocument, targetDocument, binding, handle, context } = createPair();
    const callerOrigin = obtainURLOrigin(parseURL('https://caller.example.test/').url!);
    const targetOrigin = obtainURLOrigin(parseURL('https://target.example.test/').url!);
    if (callerOrigin.kind !== 'tuple' || targetOrigin.kind !== 'tuple') throw new Error('Expected tuple origins');
    callerDocument.origin = callerOrigin;
    targetDocument.origin = targetOrigin;
    const child = createChild(targetDocument, 'relaxedChild');
    child.document.origin = callerOrigin;
    targetDocument.body!.appendChild(child.container);
    const domain = { kind: 'domain', value: 'example.test' } as const;
    callerOrigin.domain = domain;
    expect(() => binding.getWindowProxyOwnProperty('document', handle)).toThrow(context.DOMException);
    targetOrigin.domain = domain;
    expect(binding.getWindowProxyOwnProperty('document', handle)).toEqual(
      Reflect.getOwnPropertyDescriptor(handle.associatedWindow, 'document'),
    );
    callerDocument.origin = createOpaqueOrigin();
    expect(() => binding.getWindowProxyOwnProperty('relaxedChild', handle)).toThrow(context.DOMException);
    child.document.origin = { ...targetOrigin, domain: null };
    expect(binding.getWindowProxyOwnProperty('relaxedChild', handle)?.value).toBe(child.navigable.activeWindowProxy.platform);
  });

  it('resolves the current Window after navigation while retaining the proxy identity', async () => {
    const { callerDocument, targetDocument, target, binding, handle, context } = createPair();
    const proxy = handle.platform;
    targetDocument.body!.appendChild(createChild(targetDocument, 'oldChild').container);
    const descriptor = binding.getWindowProxyOwnProperty('self', handle)!;
    expect(binding.getWindowProxyOwnProperty('oldChild', handle)).toBeDefined();

    await target.navigate('https://replacement.example.test/');
    expect(handle.platform).toBe(proxy);
    expect(handle.platform).toBe(target.window);
    const replacement = unwrap<DocumentImpl>(target.document);
    expect(binding.getWindowProxyOwnProperty('self', handle)!.get).not.toBe(descriptor.get);
    expect(() => binding.getWindowProxyOwnProperty('oldChild', handle)).toThrow(context.DOMException);
    const child = createChild(replacement, 'newChild');
    replacement.body!.appendChild(child.container);
    expect(binding.getWindowProxyOwnProperty('newChild', handle)?.value).toBe(child.navigable.activeWindowProxy.platform);
    callerDocument.origin = replacement.origin;
    expect(binding.getWindowProxyOwnProperty('document', handle)).toEqual(
      Reflect.getOwnPropertyDescriptor(handle.associatedWindow, 'document'),
    );
  });
});

describe('Caller-bound WindowProxy property definition', () => {
  it('defines ordinary data and accessor descriptors without invoking their functions', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const descriptor = Object.freeze({ value: 42, writable: true, enumerable: true, configurable: true });
    expect(binding.defineWindowProxyOwnProperty('ordinary', descriptor, handle)).toBe(true);
    expect(Reflect.getOwnPropertyDescriptor(handle.associatedWindow, 'ordinary')).toEqual(descriptor);
    expect(binding.defineWindowProxyOwnProperty('ordinary', { value: 43 }, handle)).toBe(true);
    expect(Reflect.getOwnPropertyDescriptor(handle.associatedWindow, 'ordinary')).toEqual({ ...descriptor, value: 43 });

    const accessor = {
      get() { throw new Error('Definition must not invoke the getter'); },
      set(_value: unknown) { throw new Error('Definition must not invoke the setter'); },
      enumerable: false, configurable: true,
    };
    expect(binding.defineWindowProxyOwnProperty('accessor', accessor, handle)).toBe(true);
    expect(Reflect.getOwnPropertyDescriptor(handle.associatedWindow, 'accessor')).toEqual(accessor);
  });

  it('preserves ordinary success and failure for nonconfigurable properties', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    expect(binding.defineWindowProxyOwnProperty('fixed', { value: 42 }, handle)).toBe(true);
    expect(binding.defineWindowProxyOwnProperty('fixed', { value: 42 }, handle)).toBe(true);
    expect(binding.defineWindowProxyOwnProperty('fixed', { value: 43 }, handle)).toBe(false);
    expect(binding.defineWindowProxyOwnProperty('fixed', { configurable: true }, handle)).toBe(false);
    expect(binding.getWindowProxyOwnProperty('fixed', handle)).toEqual({
      value: 42, writable: false, enumerable: false, configurable: false,
    });
  });

  it.each(['0', '1', '4294967294'])('rejects defining the same-origin index %s without changing Window', (key) => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const child = createChild(targetDocument, 'childName');
    targetDocument.body!.appendChild(child.container);
    expect(binding.defineWindowProxyOwnProperty(key, { value: 'replacement', configurable: true }, handle)).toBe(false);
    expect(Reflect.getOwnPropertyDescriptor(handle.associatedWindow, key)).toBeUndefined();
    expect(binding.getWindowProxyOwnProperty('0', handle)?.value).toBe(child.navigable.activeWindowProxy.platform);
  });

  it('rejects an index even when ordinary forwarding previously created that property', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const original = { value: 'existing', writable: true, enumerable: true, configurable: true };
    Object.defineProperty(handle.associatedWindow, '0', original);
    expect(binding.defineWindowProxyOwnProperty('0', { value: 'replacement' }, handle)).toBe(false);
    expect(Reflect.getOwnPropertyDescriptor(handle.associatedWindow, '0')).toEqual(original);
  });

  it.each(['-0', '01', '1.0', '4294967295', Symbol('ordinary')])(
    'allows the same-origin non-index property %s', (key) => {
      const { callerDocument, targetDocument, binding, handle } = createPair();
      callerDocument.origin = targetDocument.origin;
      const descriptor = { value: 7, writable: true, enumerable: false, configurable: true };
      expect(binding.defineWindowProxyOwnProperty(key, descriptor, handle)).toBe(true);
      expect(Reflect.getOwnPropertyDescriptor(handle.associatedWindow, key)).toEqual(descriptor);
    },
  );

  it.each(['0', '1', '4294967294', 'location', 'postMessage', 'then', 'document', 'childName', 'newKey', Symbol.toStringTag])(
    'rejects every foreign definition of %s in the caller realm', (key) => {
      const { targetDocument, binding, handle, context, targetContext } = createPair();
      targetDocument.body!.appendChild(createChild(targetDocument, 'childName').container);
      const original = Reflect.getOwnPropertyDescriptor(handle.associatedWindow, key);
      let failure: unknown;
      try { binding.defineWindowProxyOwnProperty(key, { value: 'replacement', configurable: true }, handle); }
      catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(context.DOMException);
      expect(failure).not.toBeInstanceOf(targetContext.DOMException);
      expect(failure).toHaveProperty('name', 'SecurityError');
      expect(Reflect.getOwnPropertyDescriptor(handle.associatedWindow, key)).toEqual(original);
    },
  );

  it('rechecks live same-origin-domain without treating permission to define a name as permission to define indices', () => {
    const { callerDocument, targetDocument, binding, handle, context } = createPair();
    const callerOrigin = obtainURLOrigin(parseURL('https://caller.example.test/').url!);
    const targetOrigin = obtainURLOrigin(parseURL('https://target.example.test/').url!);
    if (callerOrigin.kind !== 'tuple' || targetOrigin.kind !== 'tuple') throw new Error('Expected tuple origins');
    callerDocument.origin = callerOrigin;
    targetDocument.origin = targetOrigin;
    const domain = { kind: 'domain', value: 'example.test' } as const;
    callerOrigin.domain = domain;
    expect(() => binding.defineWindowProxyOwnProperty('ordinary', { value: 1 }, handle)).toThrow(context.DOMException);
    targetOrigin.domain = domain;
    expect(binding.defineWindowProxyOwnProperty('ordinary', { value: 2, configurable: true }, handle)).toBe(true);
    expect(binding.defineWindowProxyOwnProperty('0', { value: 3 }, handle)).toBe(false);
    callerDocument.origin = createOpaqueOrigin();
    expect(() => binding.defineWindowProxyOwnProperty('ordinary', { value: 4 }, handle)).toThrow(context.DOMException);
    expect(Reflect.getOwnPropertyDescriptor(handle.associatedWindow, 'ordinary')?.value).toBe(2);
  });

  it('defines on the replacement Window and rechecks its origin after navigation', async () => {
    const { callerDocument, targetDocument, target, binding, handle, context } = createPair();
    callerDocument.origin = targetDocument.origin;
    const previous = handle.associatedWindow;
    const proxy = handle.platform;
    expect(binding.defineWindowProxyOwnProperty('retained', { value: 'old', configurable: true }, handle)).toBe(true);
    await target.navigate('https://replacement.example.test/');
    expect(handle.platform).toBe(proxy);
    expect(() => binding.defineWindowProxyOwnProperty('retained', { value: 'blocked' }, handle)).toThrow(context.DOMException);
    expect(Reflect.getOwnPropertyDescriptor(handle.associatedWindow, 'retained')).toBeUndefined();
    callerDocument.origin = unwrap<DocumentImpl>(target.document).origin;
    expect(binding.defineWindowProxyOwnProperty('retained', { value: 'new', configurable: true }, handle)).toBe(true);
    expect(Reflect.getOwnPropertyDescriptor(handle.associatedWindow, 'retained')?.value).toBe('new');
    expect(Reflect.getOwnPropertyDescriptor(previous, 'retained')?.value).toBe('old');
  });
});

function createPair() {
  const caller = new Browlet({ route: () => '' });
  const target = new Browlet({ route: () => '' });
  const callerDocument = unwrap<DocumentImpl>(caller.document);
  const targetDocument = unwrap<DocumentImpl>(target.document);
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
  const state = DocumentState.create(childDocument);
  state.navigableTargetName = name;
  const navigable = new Navigable(state, document.getNodeNavigable());
  // Automatic child creation is unfinished; use the retained implementation association.
  container.contentNavigable = navigable;
  return { container, navigable, document: childDocument };
}
