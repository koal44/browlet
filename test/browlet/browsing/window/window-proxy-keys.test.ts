import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext, Navigable, createDocumentState } from '../../../../src/browlet/browsing/navigation/index';
import { OpenerPolicy } from '../../../../src/browlet/browsing/policy/coop';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/index';
import { CrossOriginObjectBinding } from '../../../../src/browlet/integration/web-idl/cross-origin';
import { getBindingContext, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

// Caller selection is explicit; these exercise OwnPropertyKeys, not automatic trap interception.
describe('Caller-bound WindowProxy OwnPropertyKeys', () => {
  it('returns ordinary Window keys with no children and prefixes live child-index strings', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const ordinaryKeys = Reflect.ownKeys(handle.associatedWindow);
    expect(binding.getWindowProxyOwnPropertyKeys(handle)).toEqual(ordinaryKeys);
    createChild(targetDocument, 'first');
    createChild(targetDocument, 'second');
    expect(binding.getWindowProxyOwnPropertyKeys(handle)).toEqual(['0', '1', ...ordinaryKeys]);
  });

  it('preserves ordinary integer, string, and symbol order without filtering nonenumerable properties', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    const baseline = Reflect.ownKeys(handle.associatedWindow);
    const first = Symbol('first');
    const second = Symbol('second');
    const getter = vi.fn(() => { throw new Error('Enumeration must not invoke getters'); });
    Object.defineProperties(handle.associatedWindow, {
      10: { value: 10, configurable: true },
      2: { value: 2, configurable: true },
      firstString: { value: 1, configurable: true, enumerable: true },
      hiddenString: { get: getter, configurable: true },
      [first]: { value: 1, configurable: true },
      lastString: { value: 2, configurable: true, enumerable: true },
      [second]: { value: 2, configurable: true },
    });
    createChild(targetDocument, 'child');
    expect(binding.getWindowProxyOwnPropertyKeys(handle)).toEqual([
      '0', '2', '10', ...baseline.filter((key) => typeof key === 'string'),
      'firstString', 'hiddenString', 'lastString',
      ...baseline.filter((key) => typeof key === 'symbol'), first, second,
    ]);
    expect(getter).not.toHaveBeenCalled();
  });

  it('returns only the ordered declared foreign keys and fallback symbols', () => {
    const { targetDocument, binding, handle } = createPair();
    const getter = vi.fn(() => { throw new Error('Enumeration must not invoke getters'); });
    Object.defineProperties(handle.associatedWindow, {
      privateValue: { get: getter, configurable: true, enumerable: true },
      [Symbol('private')]: { get: getter, configurable: true },
      then: { get: getter, configurable: true },
      [Symbol.toStringTag]: { get: getter, configurable: true },
    });
    expect(withoutPendingMembers(binding.getWindowProxyOwnPropertyKeys(handle))).toEqual(foreignKeys);
    createChild(targetDocument, 'sameOriginChild');
    const foreignChild = createChild(targetDocument, 'foreignChild');
    foreignChild.document.origin = createOpaqueOrigin();
    const keys = binding.getWindowProxyOwnPropertyKeys(handle);
    expect(withoutPendingMembers(keys)).toEqual(['0', '1', ...foreignKeys]);
    expect(getter).not.toHaveBeenCalled();
  });

  it('does not enumerate a foreign named child even when its own descriptor is accessible', () => {
    const { targetDocument, binding, handle } = createPair();
    const child = createChild(targetDocument, 'namedChild');
    expect(binding.getWindowProxyOwnProperty('namedChild', handle)?.value).toBe(child.navigable.activeWindowProxy.platform);
    expect(binding.getWindowProxyOwnPropertyKeys(handle)).not.toContain('namedChild');
    expect(binding.getWindowProxyOwnPropertyKeys(handle)).toContain('0');
  });

  it.each([false, true])('recounts children without reading the replaceable length when same-origin is %s', (sameOrigin) => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    if (sameOrigin) callerDocument.origin = targetDocument.origin;
    const getter = vi.fn(() => { throw new Error('The length attribute is not the child count'); });
    Object.defineProperty(handle.associatedWindow, 'length', { get: getter, configurable: true });
    const first = createChild(targetDocument, 'first');
    const second = createChild(targetDocument, 'second');
    const tail = sameOrigin ? Reflect.ownKeys(handle.associatedWindow) : foreignKeys;
    const keys = () => {
      const result = binding.getWindowProxyOwnPropertyKeys(handle);
      return sameOrigin ? result : withoutPendingMembers(result);
    };
    expect(keys()).toEqual(['0', '1', ...tail]);
    first.container.contentNavigable = null;
    expect(keys()).toEqual(['0', ...tail]);
    targetDocument.body!.removeChild(second.container);
    expect(keys()).toEqual(tail);
    first.container.contentNavigable = first.navigable;
    expect(keys()).toEqual(['0', ...tail]);
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps numeric Window properties in only the same-origin tail: %s', (sameOrigin) => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    if (sameOrigin) callerDocument.origin = targetDocument.origin;
    createChild(targetDocument, 'first');
    createChild(targetDocument, 'second');
    for (const key of ['0', '1', '9', '01', '-0', '4294967295']) {
      Object.defineProperty(handle.associatedWindow, key, { value: key, configurable: true });
    }
    const keys = binding.getWindowProxyOwnPropertyKeys(handle);
    if (sameOrigin) {
      // Internal list concatenation preserves overlap; stock Proxy deduplication belongs at its trap.
      expect(keys).toEqual(['0', '1', ...Reflect.ownKeys(handle.associatedWindow)]);
      expect(keys.filter((key) => key === '0')).toHaveLength(2);
      expect(Reflect.ownKeys(handle.platform).filter((key) => key === '0')).toHaveLength(1);
    } else {
      expect(withoutPendingMembers(keys)).toEqual(['0', '1', ...foreignKeys]);
    }
  });

  it('retains declared foreign names after ordinary properties are deleted or replaced', () => {
    const { binding, handle } = createPair();
    Reflect.deleteProperty(handle.associatedWindow, 'self');
    Reflect.deleteProperty(handle.associatedWindow, 'close');
    Object.defineProperty(handle.associatedWindow, 'postMessage', { value: 42 });
    expect(withoutPendingMembers(binding.getWindowProxyOwnPropertyKeys(handle))).toEqual(foreignKeys);
  });

  it.each([false, true])('returns an independent key list on each call when same-origin is %s', (sameOrigin) => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    if (sameOrigin) callerDocument.origin = targetDocument.origin;
    const first = binding.getWindowProxyOwnPropertyKeys(handle);
    const snapshot = [...first];
    first.splice(0, first.length, 'caller mutation');
    const second = binding.getWindowProxyOwnPropertyKeys(handle);
    expect(second).not.toBe(first);
    expect(second).toEqual(snapshot);
    createChild(targetDocument, 'newChild');
    expect(binding.getWindowProxyOwnPropertyKeys(handle)).toEqual(['0', ...snapshot]);
    expect(second).toEqual(snapshot);
  });

  it('selects the tail from live origin-domain state without caching the caller decision', () => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    const callerOrigin = obtainURLOrigin(parseURL('https://caller.example.test/').url!);
    const targetOrigin = obtainURLOrigin(parseURL('https://target.example.test/').url!);
    if (callerOrigin.kind !== 'tuple' || targetOrigin.kind !== 'tuple') throw new Error('Expected tuple origins');
    callerDocument.origin = callerOrigin;
    targetDocument.origin = targetOrigin;
    createChild(targetDocument, 'child');
    Object.defineProperty(handle.associatedWindow, 'privateValue', { value: 42 });
    const domain = { kind: 'domain', value: 'example.test' } as const;
    callerOrigin.domain = domain;
    expect(withoutPendingMembers(binding.getWindowProxyOwnPropertyKeys(handle))).toEqual(['0', ...foreignKeys]);
    targetOrigin.domain = domain;
    expect(binding.getWindowProxyOwnPropertyKeys(handle)).toEqual(['0', ...Reflect.ownKeys(handle.associatedWindow)]);
    callerDocument.origin = createOpaqueOrigin();
    expect(withoutPendingMembers(binding.getWindowProxyOwnPropertyKeys(handle))).toEqual(['0', ...foreignKeys]);
  });

  it('uses the current Window and Document after navigation preserves the proxy identity', async () => {
    const { callerDocument, targetDocument, target, binding, handle } = createPair();
    callerDocument.origin = targetDocument.origin;
    createChild(targetDocument, 'oldFirst');
    createChild(targetDocument, 'oldSecond');
    Object.defineProperty(handle.associatedWindow, 'oldPrivate', { value: 1 });
    const oldKeys = binding.getWindowProxyOwnPropertyKeys(handle);
    const proxy = handle.platform;
    await target.navigate('https://replacement.example.test/');
    expect(handle.platform).toBe(proxy);
    expect(withoutPendingMembers(binding.getWindowProxyOwnPropertyKeys(handle))).toEqual(foreignKeys);
    const currentDocument = unwrap<DocumentImpl>(target.document);
    createChild(currentDocument, 'newChild');
    Object.defineProperty(handle.associatedWindow, 'newPrivate', { value: 2 });
    expect(withoutPendingMembers(binding.getWindowProxyOwnPropertyKeys(handle))).toEqual(['0', ...foreignKeys]);
    callerDocument.origin = currentDocument.origin;
    const keys = binding.getWindowProxyOwnPropertyKeys(handle);
    expect(keys).toEqual(['0', ...Reflect.ownKeys(handle.associatedWindow)]);
    expect(keys).not.toContain('oldPrivate');
    expect(oldKeys).toContain('oldPrivate');
    expect(oldKeys.slice(0, 2)).toEqual(['0', '1']);
  });

  it.each([false, true])('does not run Get/Set COOP reporting when same-origin is %s', (sameOrigin) => {
    const { callerDocument, targetDocument, binding, handle } = createPair();
    if (sameOrigin) callerDocument.origin = targetDocument.origin;
    targetDocument.browsingContext!.virtualBrowsingContextGroupID++;
    createChild(targetDocument, 'child');
    const reports = vi.spyOn(OpenerPolicy, 'queueAccessReports');
    expect(binding.getWindowProxyOwnPropertyKeys(handle)[0]).toBe('0');
    expect(reports).not.toHaveBeenCalled();
  });
});

// HTML's ordered keys, excluding only the already-approved focus/blur declaration gap.
const foreignKeys = [
  'window', 'self', 'location', 'close', 'closed', 'frames', 'length', 'top', 'opener', 'parent', 'postMessage',
  'then', Symbol.toStringTag, Symbol.hasInstance, Symbol.isConcatSpreadable,
];

function withoutPendingMembers(keys: (string | symbol)[]): (string | symbol)[] {
  // Do not require their absence; security.test.ts retains the complete-list expected failure.
  return keys.filter((key) => key !== 'focus' && key !== 'blur');
}

function createPair() {
  const caller = new Browlet({ route: () => '' });
  const target = new Browlet({ route: () => '' });
  const callerDocument = unwrap<DocumentImpl>(caller.document);
  const targetDocument = unwrap<DocumentImpl>(target.document);
  targetDocument.browsingContext!.virtualBrowsingContextGroupID = callerDocument.browsingContext!.virtualBrowsingContextGroupID;
  return {
    target, callerDocument, targetDocument,
    handle: targetDocument.browsingContext!.windowProxy,
    binding: new CrossOriginObjectBinding(getBindingContext(callerDocument.env.realm)),
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
