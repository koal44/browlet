import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext, Navigable, DocumentState } from '../../../../src/browlet/browsing/navigation/index';
import { OpenerPolicy } from '../../../../src/browlet/browsing/policy/coop';
import { LocationImpl } from '../../../../src/browlet/browsing/window/location';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/index';
import { CrossOriginObjectBinding } from '../../../../src/browlet/integration/web-idl/bindings/cross-origin';
import { getBindingContext, unwrap } from '../../../support/browlet-binding';
import { itPassesWith } from '../../../test-runtime';

afterEach(() => { vi.restoreAllMocks(); });

// Caller selection is explicit; these exercise Set, not automatic trap interception.
describe('Caller-bound WindowProxy Set', () => {
  it('creates and updates data properties on the receiver, preserving existing attributes', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    Object.defineProperty(handle.associatedWindow, 'data', { value: 'target', writable: true });
    const receiver = Object.defineProperty({}, 'data', { value: 'before', writable: true });
    expect(binding.setWindowProxy('data', 'after', receiver, handle)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(receiver, 'data')).toEqual({
      value: 'after', writable: true, enumerable: false, configurable: false,
    });
    expect(Reflect.get(handle.associatedWindow, 'data')).toBe('target');
    const value = {};
    expect(binding.setWindowProxy('newProperty', value, receiver, handle)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(receiver, 'newProperty')).toEqual({
      value, writable: true, enumerable: true, configurable: true,
    });
    expect(Object.hasOwn(handle.associatedWindow, 'newProperty')).toBe(false);
  });

  it('preserves values and primitive receivers for own and inherited setters', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const calls: unknown[][] = [];
    const setter = function(this: unknown, value: unknown) { calls.push([this, value]); return false; };
    const key = Symbol('own setter');
    Object.defineProperty(handle.associatedWindow, key, { set: setter });
    Object.defineProperty(Reflect.getPrototypeOf(handle.associatedWindow), 'inherited', { set: setter });
    const value = { toString() { throw new Error('Ordinary assignment does not convert its value'); } };
    for (const receiver of [handle.platform, {}, null, undefined, 7, 'text']) {
      expect(binding.setWindowProxy(key, value, receiver, handle)).toBe(true);
      expect(binding.setWindowProxy('inherited', value, receiver, handle)).toBe(true);
      expect(calls.splice(0)).toEqual([[receiver, value], [receiver, value]]);
    }
  });

  it('returns false for ordinary readonly properties, getter-only accessors, and refusing receivers', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    Object.defineProperties(handle.associatedWindow, {
      readonly: { value: 1 }, getterOnly: { get() { return 1; } }, data: { value: 1, writable: true },
    });
    expect(binding.setWindowProxy('readonly', 2, {}, handle)).toBe(false);
    expect(binding.setWindowProxy('getterOnly', 2, {}, handle)).toBe(false);
    const setter = vi.fn();
    const receiver = Object.defineProperty({}, 'data', { set: setter });
    expect(binding.setWindowProxy('data', 2, receiver, handle)).toBe(false);
    expect(setter).not.toHaveBeenCalled();
    for (const receiver of [Object.freeze({}), Object.freeze({ data: 1 }), null, undefined, 7, 'text']) {
      expect(binding.setWindowProxy('data', 2, receiver, handle)).toBe(false);
    }
  });

  it('preserves abrupt completions from setters and receiver property operations', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const failure = new Error('write failed');
    Object.defineProperty(handle.associatedWindow, 'throwing', { set() { throw failure; } });
    const receiver = new Proxy({}, { defineProperty() { throw failure; } });
    for (const property of ['throwing', 'missing']) {
      let result: unknown;
      try { binding.setWindowProxy(property, 1, receiver, handle); } catch (error) { result = error; }
      expect(result).toBe(failure);
    }
  });

  it.each(['0', '1', '4294967294'])('rejects the same-origin index %s before author setters or receiver operations', (key) => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    createChild(targetDocument, 'child');
    const setter = vi.fn();
    Object.defineProperty(handle.associatedWindow, key, { set: setter });
    const define = vi.fn(() => true);
    const receiver = new Proxy({}, { defineProperty: define });
    expect(binding.setWindowProxy(key, 'value', receiver, handle)).toBe(false);
    expect(setter).not.toHaveBeenCalled();
    expect(define).not.toHaveBeenCalled();
  });

  it('keeps non-index numeric strings and symbols on the ordinary write path', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const receiver = {};
    for (const key of ['-0', '01', '1.0', '4294967295', '4294967296', Symbol('index')]) {
      expect(binding.setWindowProxy(key, key, receiver, handle)).toBe(true);
      expect(Reflect.get(receiver, key)).toBe(key);
    }
  });

  it('uses the Window setter for same-origin replaceable attributes', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const value = {};
    expect(binding.setWindowProxy('self', value, handle.platform, handle)).toBe(true);
    expect(Reflect.get(handle.associatedWindow, 'self')).toBe(value);
  });

  it.each([
    'self', 'opener', 'postMessage', 'then', Symbol.toStringTag, Symbol.hasInstance,
    Symbol.isConcatSpreadable, 'privateValue', 'inherited', Symbol('private'),
  ])('denies the foreign property %s without invoking author setters or converting the value', (key) => {
    const { binding, handle, context, targetContext } = createPair();
    const setter = vi.fn();
    Object.defineProperty(key === 'inherited' ? Reflect.getPrototypeOf(handle.associatedWindow) : handle.associatedWindow,
      key, { set: setter });
    const convert = vi.fn(() => 'value');
    let failure: unknown;
    try { binding.setWindowProxy(key, { toString: convert }, handle.platform, handle); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(context.DOMException);
    expect(failure).not.toBeInstanceOf(targetContext.DOMException);
    expect(failure).toHaveProperty('name', 'SecurityError');
    expect(setter).not.toHaveBeenCalled();
    expect(convert).not.toHaveBeenCalled();
  });

  it.each(['0', '1', 'namedChild'])('denies foreign writes to child names and indices: %s', (key) => {
    const { targetDocument, binding, handle, context } = createPair();
    createChild(targetDocument, 'namedChild');
    const receiver = {};
    expect(() => binding.setWindowProxy(key, 1, receiver, handle)).toThrow(context.DOMException);
    expect(Object.hasOwn(receiver, key)).toBe(false);
  });

  it.each([false, true])('forwards a foreign location write through real IDL with another receiver: %s', (otherReceiver) => {
    const { binding, handle } = createPair();
    const receiver = otherReceiver ? new Browlet({ route: () => '' }).window : handle.platform;
    // Capture the unfinished navigation boundary; conversion and receiver resolution remain real.
    const setter = vi.spyOn(LocationImpl.prototype, 'setHref').mockImplementation(() => {});
    const convert = vi.fn(() => '/next/\uD800');
    expect(binding.setWindowProxy('location', { toString: convert }, receiver, handle)).toBe(true);
    expect(convert).toHaveBeenCalledOnce();
    expect(setter).toHaveBeenCalledExactlyOnceWith('/next/\uFFFD', expect.any(Object), expect.any(Object));
    expect(setter.mock.contexts[0]).toBe(unwrap<LocationImpl>(receiver.location));
  });

  it('uses the caller realm for invalid foreign setter receivers', () => {
    const { binding, handle, context } = createPair();
    expect(() => binding.setWindowProxy('location', '/next', {}, handle)).toThrow(context.realm.TypeError);
  });

  itPassesWith('nativeGlobals')('keeps the caller realm through PutForwards conversion', () => {
    const { binding, handle, context, targetContext } = createPair();
    // The caller's foreign Location.href setter performs the USVString conversion.
    // Chromium, Firefox, and WebKit all throw the caller's TypeError here.
    let failure: unknown;
    try { binding.setWindowProxy('location', Symbol(), handle.platform, handle); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(context.realm.TypeError);
    expect(failure).not.toBeInstanceOf(targetContext.realm.TypeError);
  });

  it('rechecks the current Window and origin after navigation', async () => {
    const { callerDocument, targetDocument, target, binding, handle, context } = createPair();
    callerDocument.origin = targetDocument.origin;
    const receiver = {};
    expect(binding.setWindowProxy('data', 1, receiver, handle)).toBe(true);
    const proxy = handle.platform;
    await target.navigate('https://replacement.example.test/');
    expect(handle.platform).toBe(proxy);
    expect(() => binding.setWindowProxy('data', 2, receiver, handle)).toThrow(context.DOMException);
    expect(Reflect.get(receiver, 'data')).toBe(1);
    callerDocument.origin = unwrap<DocumentImpl>(target.document).origin;
    expect(binding.setWindowProxy('data', 3, receiver, handle)).toBe(true);
    expect(Reflect.get(receiver, 'data')).toBe(3);
  });
});

describe('WindowProxy Set COOP reporting order', () => {
  it('checks access before a same-origin author setter runs', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    targetDocument.browsingContext!.virtualBrowsingContextGroupID++;
    const order: string[] = [];
    vi.spyOn(OpenerPolicy, 'queueAccessReports').mockImplementation(() => { order.push('report'); });
    Object.defineProperty(handle.associatedWindow, 'self', { set() { order.push('setter'); } });
    expect(binding.setWindowProxy('self', 1, handle.platform, handle)).toBe(true);
    expect(order).toEqual(['report', 'setter']);
  });

  it.each([false, true])('checks access before rejecting an index with same-origin %s', (sameOrigin) => {
    const { callerDocument, targetDocument, binding, handle, context } = createPair();
    if (sameOrigin) callerDocument.origin = targetDocument.origin;
    targetDocument.browsingContext!.virtualBrowsingContextGroupID++;
    createChild(targetDocument, 'child');
    const reports = vi.spyOn(OpenerPolicy, 'queueAccessReports').mockImplementation(() => {});
    if (sameOrigin) expect(binding.setWindowProxy('0', 1, handle.platform, handle)).toBe(false);
    else expect(() => binding.setWindowProxy('0', 1, handle.platform, handle)).toThrow(context.DOMException);
    expect(reports).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ propertyName: '0' }), callerDocument.env);
  });

  it('reports before location conversion and uses the caller/target contexts, independently of Receiver', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    targetDocument.browsingContext!.virtualBrowsingContextGroupID++;
    const other = new Browlet({ route: () => '' });
    const order: string[] = [];
    const reports = vi.spyOn(OpenerPolicy, 'queueAccessReports').mockImplementation(() => { order.push('report'); });
    const setter = vi.spyOn(LocationImpl.prototype, 'setHref').mockImplementation(() => { order.push('setter'); });
    const value = { toString() { order.push('convert'); return '/next'; } };
    expect(binding.setWindowProxy('location', value, other.window, handle)).toBe(true);
    expect(order).toEqual(['report', 'convert', 'setter']);
    expect(reports).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      propertyName: 'location', accessorOrigin: callerDocument.origin, accessedOrigin: targetDocument.origin,
    }), callerDocument.env);
    expect(setter.mock.contexts[0]).toBe(unwrap<LocationImpl>(other.window.location));
  });

  it('propagates report-dispatch failures without invoking a setter', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    targetDocument.browsingContext!.virtualBrowsingContextGroupID++;
    const failure = new Error('report dispatch failed');
    vi.spyOn(OpenerPolicy, 'queueAccessReports').mockImplementation(() => { throw failure; });
    const setter = vi.fn();
    Object.defineProperty(handle.associatedWindow, 'self', { set: setter });
    let result: unknown;
    try { binding.setWindowProxy('self', 1, handle.platform, handle); } catch (error) { result = error; }
    expect(result).toBe(failure);
    expect(setter).not.toHaveBeenCalled();
  });

  it('uses the real early returns for matching virtual groups and non-reportable names', () => {
    const { callerDocument, targetDocument, binding, handle, context } = createPair();
    const reports = vi.spyOn(OpenerPolicy, 'queueAccessReports');
    expect(() => binding.setWindowProxy('self', 1, handle.platform, handle)).toThrow(context.DOMException);
    targetDocument.browsingContext!.virtualBrowsingContextGroupID++;
    expect(() => binding.setWindowProxy('then', 1, handle.platform, handle)).toThrow(context.DOMException);
    callerDocument.origin = targetDocument.origin;
    expect(binding.setWindowProxy('data', 1, {}, handle)).toBe(true);
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
  const state = DocumentState.create(childDocument);
  state.navigableTargetName = name;
  const navigable = new Navigable(state, document.getNodeNavigable());
  // Automatic child creation is unfinished; connect the retained implementation association.
  container.contentNavigable = navigable;
  document.body!.appendChild(container);
}
