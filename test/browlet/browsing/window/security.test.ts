/* eslint-disable @typescript-eslint/unbound-method -- Inspect IDL function identities and invoke them with explicit receivers. */
import { describe, expect, it } from 'vitest';

import type { JSFunction } from '../../../../src/js-engine/index';

import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { CrossOriginObjectBinding } from '../../../../src/browlet/integration/web-idl/cross-origin';
import { getBindingContext, unwrap } from '../../../support/browlet-binding';

describe('Window and Location security', () => {
  it('rejects borrowed Window and Location getters across origins', async () => {
    const { caller, target } = await createWindows();
    const document = Object.getOwnPropertyDescriptor(caller.window, 'document')!;
    const href = Object.getOwnPropertyDescriptor(caller.window.location, 'href')!;
    expect(() => { Reflect.apply(document.get!, target.window, []); }).toThrow(caller.window.DOMException);
    expect(() => { Reflect.apply(href.get!, target.window.location, []); }).toThrow(caller.window.DOMException);
  });

  // TODO(HTML 7.2.2): Declare the remaining Window members and their cross-origin permissions.
  it.fails('permits the complete Window getter, setter, and method combinations', async () => {
    const { callerContext, targetWindow } = await createWindows();
    const getters = ['window', 'self', 'location', 'closed', 'frames', 'length', 'top', 'opener', 'parent'];
    const methods = ['close', 'focus', 'blur', 'postMessage'];
    for (const name of [...getters, ...methods, 'document', 'fetch', '0']) {
      for (const type of ['getter', 'setter', 'method'] as const) {
        const check = () => { callerContext.performSecurityCheck(targetWindow, name, type); };
        const allowed = type === 'getter' ? getters.includes(name)
          : type === 'setter' ? name === 'location' : methods.includes(name);
        if (allowed) expect(check).not.toThrow();
        else expect(check).toThrow(expect.objectContaining({ name: 'SecurityError' }));
      }
    }
  });

  it('permits only the specified Location access and leaves other object types alone', async () => {
    const { callerContext, target } = await createWindows();
    for (const name of ['href', 'replace', 'assign', 'origin']) {
      for (const type of ['getter', 'setter', 'method'] as const) {
        const check = () => { callerContext.performSecurityCheck(target.window.location, name, type); };
        if ((name === 'href' && type === 'setter') || (name === 'replace' && type === 'method')) {
          expect(check).not.toThrow();
        } else {
          expect(check).toThrow(expect.objectContaining({ name: 'SecurityError' }));
        }
      }
    }
    expect(() => callerContext.performSecurityCheck(target.document, 'URL', 'getter')).not.toThrow();
    expect(() => callerContext.performSecurityCheck({}, 'document', 'getter')).not.toThrow();
  });

  it('uses the invoked IDL function realm and the receiver origin, including relaxed domains', async () => {
    const { caller, target, binding, targetWindow } = await createWindows();
    const ownGetter = Object.getOwnPropertyDescriptor(caller.window, 'document')!;
    const foreignGetter = Object.getOwnPropertyDescriptor(target.window, 'document')!;
    expect(Reflect.apply(ownGetter.get!, caller.window, [])).toBe(caller.document);
    expect(binding.isPlatformObjectSameOrigin(targetWindow)).toBe(false);
    caller.document.domain = 'example.com';
    expect(() => { Reflect.apply(ownGetter.get!, target.window, []); }).toThrow();
    target.document.domain = 'example.com';
    expect(binding.isPlatformObjectSameOrigin(targetWindow)).toBe(true);
    expect(Reflect.apply(ownGetter.get!, target.window, [])).toBe(target.document);
    expect(Reflect.apply(foreignGetter.get!, caller.window, [])).toBe(caller.document);
  });

  it('distinguishes opaque origins even when the URLs match', () => {
    const caller = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    const callerEnv = unwrap<DocumentImpl>(caller.document).env;
    const targetEnv = unwrap<DocumentImpl>(target.document).env;
    const binding = new CrossOriginObjectBinding(getBindingContext(callerEnv.realm));
    expect(binding.isPlatformObjectSameOrigin(callerEnv.global)).toBe(true);
    expect(binding.isPlatformObjectSameOrigin(targetEnv.global)).toBe(false);
  });

  it('retains descriptor identities per caller and target, with fresh caller-realm IDL functions', async () => {
    const { caller, target, callerContext, targetContext, binding, targetWindow } = await createWindows();
    const descriptor = binding.crossOriginGetOwnPropertyHelper(targetWindow, 'self')!;
    expect(descriptor).toMatchObject({ set: undefined, enumerable: false, configurable: true });
    expect(descriptor.get).toBeInstanceOf(callerContext.realm.Function);
    expect(descriptor.get).toHaveProperty('name', 'get self');
    expect(descriptor.get).toHaveProperty('length', 0);
    expect(descriptor.get).not.toBe(Object.getOwnPropertyDescriptor(caller.window, 'self')!.get);
    expect(descriptor).toBe(binding.crossOriginGetOwnPropertyHelper(targetWindow, 'self'));
    expect(descriptor).toBe(new CrossOriginObjectBinding(callerContext).crossOriginGetOwnPropertyHelper(targetWindow, 'self'));
    const differentCaller = new CrossOriginObjectBinding(targetContext).crossOriginGetOwnPropertyHelper(targetWindow, 'self')!;
    const differentTarget = binding.crossOriginGetOwnPropertyHelper(callerContext.getEnvironment().global, 'self')!;
    expect(differentCaller.get).not.toBe(descriptor.get);
    expect(differentTarget.get).not.toBe(descriptor.get);
    expect(Reflect.apply(descriptor.get!, target.window, [])).toBe(target.window);
    expect(Reflect.apply(descriptor.get!, caller.window, [])).toBe(caller.window);
    expect(() => { Reflect.apply(descriptor.get!, {}, []); }).toThrow(callerContext.realm.TypeError);

    await target.navigate('https://replacement.example.com/');
    const replacementWindow = unwrap<DocumentImpl>(target.document).env.global;
    expect(binding.crossOriginGetOwnPropertyHelper(replacementWindow, 'self')!.get).not.toBe(descriptor.get);
    expect(binding.crossOriginGetOwnPropertyHelper(targetWindow, 'self')).toBe(descriptor);
  });

  it('uses declared accessor steps despite author replacements', async () => {
    const { target, binding, targetWindow } = await createWindows();
    Object.defineProperty(targetWindow, 'self', { get() { throw new Error('Author getter must not run'); } });
    const descriptor = binding.crossOriginGetOwnPropertyHelper(targetWindow, 'self')!;
    expect(Reflect.apply(descriptor.get!, target.window, [])).toBe(target.window);
    expect(binding.crossOriginGetOwnPropertyHelper(targetWindow, 'document')).toBeUndefined();
  });

  it('preserves a non-callable value for Window.close', async () => {
    const { binding, targetWindow } = await createWindows();
    Object.defineProperty(targetWindow, 'close', { value: 42 });
    expect(binding.crossOriginGetOwnPropertyHelper(targetWindow, 'close')).toEqual({
      value: 42, writable: false, enumerable: false, configurable: true,
    });
  });

  it('creates Location functions with caller-realm conversion and receiver checks', async () => {
    const { callerContext, target, binding } = await createWindows();
    const href = binding.crossOriginGetOwnPropertyHelper(target.window.location, 'href')!;
    const replace = binding.crossOriginGetOwnPropertyHelper(target.window.location, 'replace')!;
    expect(href).toMatchObject({ get: undefined, enumerable: false, configurable: true });
    expect(href.set).toBeInstanceOf(callerContext.realm.Function);
    expect(href.set).toHaveProperty('name', 'set href');
    expect(href.set).toHaveProperty('length', 1);
    expect(replace).toMatchObject({ writable: false, enumerable: false, configurable: true });
    expect(replace.value).toBeInstanceOf(callerContext.realm.Function);
    expect(replace.value).toHaveProperty('name', 'replace');
    expect(replace.value).toHaveProperty('length', 1);
    expect(replace.value).not.toBe(target.window.location.replace);
    expect(() => { Reflect.apply(href.set!, target.window.location, [Symbol()]); }).toThrow(callerContext.realm.TypeError);
    expect(() => { Reflect.apply(replace.value as JSFunction, target.window.location, [Symbol()]); }).toThrow(callerContext.realm.TypeError);
    expect(() => { Reflect.apply(replace.value as JSFunction, {}, ['/next']); }).toThrow(callerContext.realm.TypeError);
  });

  it.fails('includes the complete ordered Window keys and accessible names', async () => {
    const { binding, targetWindow } = await createWindows();
    expect(binding.crossOriginOwnPropertyKeys(targetWindow)).toEqual([
      'window', 'self', 'location', 'close', 'closed', 'focus', 'blur', 'frames',
      'length', 'top', 'opener', 'parent', 'postMessage',
      'then', Symbol.toStringTag, Symbol.hasInstance, Symbol.isConcatSpreadable,
    ]);
    expect(binding.isCrossOriginAccessibleWindowPropertyName('postMessage')).toBe(true);
  });

  it('orders Location keys, restricts fallback properties, and recognizes array indices', async () => {
    const { caller, target, binding } = await createWindows();
    const fallback = ['then', Symbol.toStringTag, Symbol.hasInstance, Symbol.isConcatSpreadable];
    expect(binding.crossOriginOwnPropertyKeys(target.window.location)).toEqual(['href', 'replace', ...fallback]);
    for (const property of fallback) {
      expect(binding.crossOriginPropertyFallback(property)).toEqual({
        value: undefined, writable: false, enumerable: false, configurable: true,
      });
    }
    for (const property of ['document', 'toString', Symbol.iterator, Symbol('then')]) {
      expect(() => binding.crossOriginPropertyFallback(property)).toThrow(caller.window.DOMException);
    }
    for (const name of ['window', '0', '4294967294']) {
      expect(binding.isCrossOriginAccessibleWindowPropertyName(name)).toBe(true);
    }
    for (const name of ['then', 'document', '-0', '01', '1.0', '4294967295', '4294967296']) {
      expect(binding.isCrossOriginAccessibleWindowPropertyName(name)).toBe(false);
    }
  });

  it('gets and sets through the selected descriptor with the supplied receiver', async () => {
    const { caller, binding } = await createWindows();
    const receiver = { value: 'before' };
    const object = Object.defineProperties({}, {
      data: { value: 7 },
      accessor: {
        get(this: typeof receiver) { return this.value; },
        set(this: typeof receiver, value: string) { this.value = value; },
      },
      setterOnly: { set() {} },
    });
    expect(binding.crossOriginGet(object, 'data', receiver)).toBe(7);
    expect(binding.crossOriginGet(object, 'accessor', receiver)).toBe('before');
    expect(binding.crossOriginSet(object, 'accessor', 'after', receiver)).toBe(true);
    expect(receiver.value).toBe('after');
    expect(() => binding.crossOriginGet(object, 'setterOnly', receiver)).toThrow(caller.window.DOMException);
    expect(() => binding.crossOriginSet(object, 'data', 8, receiver)).toThrow(caller.window.DOMException);
  });
});

async function createWindows() {
  const caller = new Browlet({ route: () => '' });
  const target = new Browlet({ route: () => '' });
  await caller.navigate('https://caller.example.com/');
  await target.navigate('https://target.example.com/');
  const callerContext = getBindingContext(unwrap<DocumentImpl>(caller.document).env.realm);
  const targetContext = getBindingContext(unwrap<DocumentImpl>(target.document).env.realm);
  return {
    caller, target, callerContext, targetContext,
    binding: new CrossOriginObjectBinding(callerContext),
    targetWindow: targetContext.getEnvironment().global,
  };
}
