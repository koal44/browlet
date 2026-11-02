import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpaqueOrigin } from '../../../../src/url/index';
import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext, Navigable, createDocumentState } from '../../../../src/browlet/browsing/navigation/index';
import { OpenerPolicy } from '../../../../src/browlet/browsing/policy/coop';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/index';
import { CrossOriginObjectBinding } from '../../../../src/browlet/integration/web-idl/bindings/cross-origin';
import { getBindingContext, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

// Caller selection is explicit; these exercise the Get algorithm, not automatic trap interception.
describe('Caller-bound WindowProxy Get', () => {
  it('reads own data, getterless accessors, and missing properties without falling through a present descriptor', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    Object.defineProperties(handle.associatedWindow, {
      data: { value: 42 },
      masked: { value: undefined },
      setterOnly: { set() { throw new Error('Read must not call a setter'); } },
    });
    Object.defineProperty(Reflect.getPrototypeOf(handle.associatedWindow), 'masked', {
      get() { throw new Error('An own undefined value hides the prototype'); },
    });
    expect(binding.getWindowProxy('data', handle.platform, handle)).toBe(42);
    expect(binding.getWindowProxy('masked', handle.platform, handle)).toBeUndefined();
    expect(binding.getWindowProxy('setterOnly', handle.platform, handle)).toBeUndefined();
    expect(binding.getWindowProxy('missing', handle.platform, handle)).toBeUndefined();
  });

  it('preserves explicit receivers for own and inherited getters, including primitive receivers', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const key = Symbol('own getter');
    const getter = function(this: unknown) { return this; };
    Object.defineProperty(handle.associatedWindow, key, { get: getter });
    Object.defineProperty(Reflect.getPrototypeOf(handle.associatedWindow), 'inherited', { get: getter });
    for (const receiver of [handle.platform, {}, null, undefined, 7, 'text']) {
      expect(binding.getWindowProxy(key, receiver, handle)).toBe(receiver);
      expect(binding.getWindowProxy('inherited', receiver, handle)).toBe(receiver);
    }
  });

  it('preserves getter exceptions without changing their identity', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const failure = new Error('getter failed');
    Object.defineProperty(handle.associatedWindow, 'throwing', { get() { throw failure; } });
    let result: unknown;
    try { binding.getWindowProxy('throwing', handle.platform, handle); } catch (error) { result = error; }
    expect(result).toBe(failure);
  });

  it('uses proxy descriptors for absent indices before continuing at the Window prototype', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    Object.defineProperty(handle.associatedWindow, '0', { value: 'hidden numeric expando' });
    expect(binding.getWindowProxy('0', handle.platform, handle)).toBeUndefined();
    const receiver = {};
    Object.defineProperty(Reflect.getPrototypeOf(handle.associatedWindow), '0', {
      get(this: unknown) { return this; },
    });
    expect(binding.getWindowProxy('0', receiver, handle)).toBe(receiver);
  });

  it('reaches same-origin named properties through the existing Window prototype chain', () => {
    const { callerDocument, targetDocument, target, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const element = target.document.createElement('div');
    element.id = 'namedElement';
    target.document.body!.appendChild(element);
    const child = createChild(targetDocument, 'namedChild');
    expect(binding.getWindowProxy('namedElement', handle.platform, handle)).toBe(element);
    expect(binding.getWindowProxy('namedChild', handle.platform, handle)).toBe(child.navigable.activeWindowProxy.platform);
  });

  it.each([false, true])('reads child indices when same-origin is %s', (sameOrigin) => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    if (sameOrigin) callerDocument.origin = targetDocument.origin;
    const child = createChild(targetDocument, 'child');
    child.document.origin = createOpaqueOrigin();
    expect(binding.getWindowProxy('0', {}, handle)).toBe(child.navigable.activeWindowProxy.platform);
  });

  it.each(['document', 'privateValue', 'inherited', '1', Symbol('private')])(
    'rejects the foreign property %s before invoking author getters', (key) => {
      const { binding, handle, context, targetContext } = createPair();
      const getter = vi.fn(() => 'secret');
      if (key === 'inherited') Object.defineProperty(Reflect.getPrototypeOf(handle.associatedWindow), key, { get: getter });
      else if (key !== 'document') Object.defineProperty(handle.associatedWindow, key, { get: getter });
      let failure: unknown;
      try { binding.getWindowProxy(key, handle.platform, handle); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(context.DOMException);
      expect(failure).not.toBeInstanceOf(targetContext.DOMException);
      expect(failure).toHaveProperty('name', 'SecurityError');
      expect(getter).not.toHaveBeenCalled();
    },
  );

  it.each(['then', Symbol.toStringTag, Symbol.hasInstance, Symbol.isConcatSpreadable])(
    'returns the foreign fallback for %s without reading author overrides', (key) => {
      const { binding, handle } = createPair();
      const getter = vi.fn(() => 'secret');
      Object.defineProperty(handle.associatedWindow, key, { get: getter });
      expect(binding.getWindowProxy(key, handle.platform, handle)).toBeUndefined();
      expect(getter).not.toHaveBeenCalled();
    },
  );

  it('uses declared foreign getters and cached caller-realm methods instead of author replacements', () => {
    const { binding, handle, context } = createPair();
    const authorGetter = vi.fn(() => 'replaced self');
    const authorMethod = vi.fn(() => 'replaced postMessage');
    Object.defineProperty(handle.associatedWindow, 'self', { get: authorGetter });
    Object.defineProperty(handle.associatedWindow, 'postMessage', { value: authorMethod });
    expect(binding.getWindowProxy('self', handle.platform, handle)).toBe(handle.platform);
    expect(authorGetter).not.toHaveBeenCalled();
    const method = binding.getWindowProxy('postMessage', handle.platform, handle);
    expect(method).toBeInstanceOf(context.realm.Function);
    expect(method).not.toBe(authorMethod);
    expect(binding.getWindowProxy('postMessage', handle.platform, handle)).toBe(method);
    expect(method).toBe(binding.getWindowProxyOwnProperty('postMessage', handle)?.value);
  });

  it('preserves non-callable permitted method values', () => {
    const { binding, handle } = createPair();
    Object.defineProperty(handle.associatedWindow, 'close', { value: 42 });
    expect(binding.getWindowProxy('close', handle.platform, handle)).toBe(42);
  });

  it('uses the supplied receiver for foreign IDL getters and reports conversion errors in the caller realm', () => {
    const { binding, handle, context } = createPair();
    const other = new Browlet({ route: () => '' });
    expect(binding.getWindowProxy('self', other.window, handle)).toBe(other.window);
    expect(() => binding.getWindowProxy('self', {}, handle)).toThrow(context.realm.TypeError);
  });

  it('selects foreign named-child values ahead of ordinary Window properties', () => {
    const { targetDocument, binding, handle } = createPair();
    const child = createChild(targetDocument, 'namedChild');
    Object.defineProperty(handle.associatedWindow, 'namedChild', { value: 'shadow' });
    expect(binding.getWindowProxy('namedChild', handle.platform, handle)).toBe(child.navigable.activeWindowProxy.platform);
  });

  it('rechecks the Window and origin after navigation without changing the proxy identity', async () => {
    const { callerDocument, targetDocument, target, binding, handle, context } = createPair();
    callerDocument.origin = targetDocument.origin;
    expect(binding.getWindowProxy('document', handle.platform, handle)).toBe(target.document);
    const proxy = handle.platform;
    await target.navigate('https://replacement.example.test/');
    expect(handle.platform).toBe(proxy);
    expect(() => binding.getWindowProxy('document', handle.platform, handle)).toThrow(context.DOMException);
    callerDocument.origin = unwrap<DocumentImpl>(target.document).origin;
    expect(binding.getWindowProxy('document', handle.platform, handle)).toBe(target.document);
  });
});

describe('WindowProxy Get COOP reporting order', () => {
  it('checks access before a same-origin author getter runs', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    targetDocument.browsingContext!.virtualBrowsingContextGroupID++;
    const order: string[] = [];
    // Capture the unfinished report-dispatch boundary; this does not test delivery.
    vi.spyOn(OpenerPolicy, 'queueAccessReports').mockImplementation(() => { order.push('report'); });
    Object.defineProperty(handle.associatedWindow, 'self', { get() { order.push('getter'); return 42; } });
    expect(binding.getWindowProxy('self', handle.platform, handle)).toBe(42);
    expect(order).toEqual(['report', 'getter']);
  });

  it.each([false, true])('reports permitted child-index reads when same-origin is %s', (sameOrigin) => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    if (sameOrigin) callerDocument.origin = targetDocument.origin;
    targetDocument.browsingContext!.virtualBrowsingContextGroupID++;
    const child = createChild(targetDocument, 'child');
    const reports = vi.spyOn(OpenerPolicy, 'queueAccessReports').mockImplementation(() => {});
    expect(binding.getWindowProxy('0', handle.platform, handle)).toBe(child.navigable.activeWindowProxy.platform);
    expect(reports).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ propertyName: '0' }), callerDocument.env);
  });

  it('reports a foreign missing index before its SecurityError', () => {
    const { callerDocument, targetDocument, binding, handle, context } = createPair();
    targetDocument.browsingContext!.virtualBrowsingContextGroupID++;
    const reports = vi.spyOn(OpenerPolicy, 'queueAccessReports').mockImplementation(() => {});
    expect(() => binding.getWindowProxy('0', handle.platform, handle)).toThrow(context.DOMException);
    expect(reports).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ propertyName: '0' }), callerDocument.env);
  });

  it('propagates a report-dispatch failure before looking up or invoking the getter', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    targetDocument.browsingContext!.virtualBrowsingContextGroupID++;
    const failure = new Error('report dispatch failed');
    vi.spyOn(OpenerPolicy, 'queueAccessReports').mockImplementation(() => { throw failure; });
    const getter = vi.fn(() => 42);
    Object.defineProperty(handle.associatedWindow, 'self', { get: getter });
    let result: unknown;
    try { binding.getWindowProxy('self', handle.platform, handle); } catch (error) { result = error; }
    expect(result).toBe(failure);
    expect(getter).not.toHaveBeenCalled();
  });

  it('uses the caller and target contexts for reporting even when the receiver is another Window', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    targetDocument.browsingContext!.virtualBrowsingContextGroupID++;
    const other = new Browlet({ route: () => '' });
    const reports = vi.spyOn(OpenerPolicy, 'queueAccessReports').mockImplementation(() => {});
    expect(binding.getWindowProxy('self', other.window, handle)).toBe(other.window);
    expect(reports).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      propertyName: 'self', accessorOrigin: callerDocument.origin, accessedOrigin: targetDocument.origin,
    }), callerDocument.env);
  });

  it('uses the real early returns for matching virtual groups and non-reportable properties', () => {
    const { callerDocument, targetDocument, binding, handle, context } = createPair();
    const reports = vi.spyOn(OpenerPolicy, 'queueAccessReports');
    expect(binding.getWindowProxy('self', handle.platform, handle)).toBe(handle.platform);
    targetDocument.browsingContext!.virtualBrowsingContextGroupID++;
    expect(binding.getWindowProxy('then', handle.platform, handle)).toBeUndefined();
    expect(() => binding.getWindowProxy('document', handle.platform, handle)).toThrow(context.DOMException);
    callerDocument.origin = targetDocument.origin;
    expect(binding.getWindowProxy('document', handle.platform, handle)).toBeDefined();
    expect(reports).not.toHaveBeenCalled();
  });
});

function createPair() {
  const caller = new Browlet({ route: () => '' });
  const target = new Browlet({ route: () => '' });
  const callerDocument = unwrap<DocumentImpl>(caller.document);
  const targetDocument = unwrap<DocumentImpl>(target.document);
  // Ordinary read cases share a virtual group; reporting cases separate it explicitly.
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
  return { container, navigable, document: childDocument };
}
