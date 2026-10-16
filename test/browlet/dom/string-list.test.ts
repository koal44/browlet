import { describe, expect, it } from 'vitest';

import { BindingWorld, reference } from '../../../src/web-idl/index';
import { Browlet } from '../../../src/browlet/browlet';
import { DOMStringListImpl, domStringListIDL } from '../../../src/browlet/dom/string-list';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/index';
import type { DOMStringList } from '../../../src/browlet/platform';
import { getBindingContext, getRelevantRealm, unwrap } from '../../support/browlet-binding';
import { installTestBindings } from '../../support/web-idl-binding';
import { TestRealm } from '../../support/web-idl-realm';

/* eslint-disable @typescript-eslint/unbound-method -- These tests borrow methods and supply receivers through Reflect.apply. */

describe('DOMStringList', () => {
  it('retains the associated list with exact strings, order, and duplicates', () => {
    const strings = ['', 'Name', 'Name', '\ud800'];
    const list = new DOMStringListImpl(strings);
    expect(list.length).toBe(4);
    expect([list.item(0), list.item(1), list.item(2), list.item(3), list.item(4)])
      .toEqual(['', 'Name', 'Name', '\ud800', null]);
    expect([list.contains(''), list.contains('Name'), list.contains('name'), list.contains('\ud800')])
      .toEqual([true, true, false, true]);
    strings.splice(1);
    expect(list.length).toBe(1);
    expect(list.contains('Name')).toBe(false);
    expect([...list.getSupportedPropertyIndices()]).toEqual([0]);
  });

  it('projects live readonly indices and the standard indexed-property iterator', () => {
    const strings = ['', 'second'];
    const { browser, platform } = projectList(strings);
    expect([platform.length, platform[0], platform[1], platform[2], platform.item(2)])
      .toEqual([2, '', 'second', undefined, null]);
    expect(Object.keys(platform)).toEqual(['0', '1']);
    expect(Object.getOwnPropertyDescriptor(platform, '0'))
      .toEqual({ value: '', writable: false, enumerable: true, configurable: true });
    expect(Reflect.get(platform, Symbol.iterator)).toBe(getRelevantRealm(browser.window).intrinsics.array.prototype.values);
    expect([...platform]).toEqual(strings);
    expect(Reflect.set(platform, '0', 'replacement')).toBe(false);
    expect(Reflect.set(platform, 'length', 0)).toBe(false);
    expect(Reflect.deleteProperty(platform, '0')).toBe(false);
    expect(Reflect.defineProperty(platform, '0', { value: 'replacement' })).toBe(false);
    expect(Reflect.get(platform, '00')).toBeUndefined();
    strings.splice(0, 1);
    expect([platform.length, platform[0], platform[1], platform.item(1)])
      .toEqual([1, 'second', undefined, null]);
    expect(Object.keys(platform)).toEqual(['0']);
    strings.push('third');
    expect([...platform]).toEqual(['second', 'third']);
    expect(Reflect.set(platform, 'note', 1)).toBe(true);
    expect(platform.length).toBe(2);
  });

  it('uses Web IDL argument conversion and receiver checks', () => {
    const { browser, platform } = projectList(['first', 'null']);
    const { item, contains } = browser.window.DOMStringList.prototype;
    const TypeError_ = getRelevantRealm(browser.window).intrinsics.typeError;
    expect(Reflect.apply(item, platform, [2 ** 32])).toBe('first');
    expect(Reflect.apply(item, platform, [1.9])).toBe('null');
    expect(Reflect.apply(item, platform, [-1])).toBeNull();
    expect(Reflect.apply(contains, platform, [null])).toBe(true);
    expect(Reflect.apply(contains, platform, [{ toString: () => 'first' }])).toBe(true);
    expect(() => { Reflect.apply(item, platform, []); }).toThrow(TypeError_);
    expect(() => { Reflect.apply(contains, platform, []); }).toThrow(TypeError_);
    expect(() => { Reflect.apply(contains, platform, [Symbol()]); }).toThrow(TypeError_);
    expect(() => { Reflect.apply(item, {}, [0]); }).toThrow(TypeError_);
  });

  it('gives a Document its own list and preserves projected identity and realm', async () => {
    const browser = new Browlet({ route: () => '' });
    const other = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.window.document);
    const otherDocument = unwrap<DocumentImpl>(other.window.document);
    const list = document.ancestorOriginsList!;
    expect(list).toBeInstanceOf(DOMStringListImpl);
    expect(list).not.toBe(otherDocument.ancestorOriginsList);
    const context = getBindingContext(getRelevantRealm(browser.window));
    const platform = context.implToJS(list, reference(DOMStringListImpl)) as DOMStringList;
    expect(platform).toBeInstanceOf(browser.window.DOMStringList);
    expect(platform).not.toBeInstanceOf(other.window.DOMStringList);
    expect(platform.length).toBe(0);
    expect(context.implToJS(list, reference(DOMStringListImpl))).toBe(platform);
    const foreignItem = other.window.DOMStringList.prototype.item;
    expect(Reflect.apply(foreignItem, platform, [0])).toBeNull();
    expect(() => { Reflect.apply(foreignItem, platform, []); })
      .toThrow(getRelevantRealm(other.window).intrinsics.typeError);
    expect(await browser.evaluate(() => {
      try { Reflect.construct(DOMStringList, []); return false; }
      catch (error) { return error instanceof TypeError; }
    })).toBe(true);
  });

  it('exposes the interface to Worker bindings without claiming a Worker implementation', () => {
    const { globalObject } = installTestBindings(
      new BindingWorld([domStringListIDL]),
      new TestRealm({ globalNames: ['Worker'] }),
    );
    expect(typeof Reflect.get(globalObject, 'DOMStringList')).toBe('function');
  });
});

function projectList(strings: string[]): { browser: Browlet; platform: DOMStringList; } {
  const browser = new Browlet({ route: () => '' });
  const context = getBindingContext(getRelevantRealm(browser.window));
  const platform = context.implToJS(new DOMStringListImpl(strings), reference(DOMStringListImpl)) as DOMStringList;
  return { browser, platform };
}
