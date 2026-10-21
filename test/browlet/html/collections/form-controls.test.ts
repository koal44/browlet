import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { HTML_NAMESPACE } from '../../../../src/infra/index';
import { reference } from '../../../../src/web-idl/index';
import {
  HTMLFormControlsCollectionImpl, HTMLInputElementImpl, RadioNodeListImpl,
} from '../../../../src/browlet/dom/nodes/html/forms/index';
import { getBindingContext, getRelevantRealm } from '../../../support/browlet-binding';
import { createTestDocument } from '../../../support/dom';

describe('HTMLFormControlsCollection', () => {
  it('keeps named results live and includes each matching control only once', () => {
    const document = createTestDocument();
    const root = document.createElement('root');
    const first = document.createElementNS(HTML_NAMESPACE, 'input');
    const second = document.createElementNS(HTML_NAMESPACE, 'input');
    first.setAttribute('id', 'group');
    first.setAttribute('name', 'group');
    second.setAttribute('name', 'group');
    root.appendChild(first);
    root.appendChild(second);
    // Membership is supplied by the owner; form association is tested separately below.
    const controls = new HTMLFormControlsCollectionImpl({ root, collect: () => [...root.children] });
    expect(controls.namedItemOrItems('')).toBeNull();
    expect(controls.namedItemOrItems('missing')).toBeNull();
    expect([...controls.getSupportedPropertyNames()]).toEqual(['group']);
    const list = controls.namedItemOrItems('group');
    expect(list).toBeInstanceOf(RadioNodeListImpl);
    if (!(list instanceof RadioNodeListImpl)) throw new Error('Expected a radio node list');
    expect(Array.from(list)).toEqual([first, second]);
    expect(controls.namedItemOrItems('group')).not.toBe(list);

    first.remove();
    expect(controls.namedItemOrItems('group')).toBe(second);
    expect(Array.from(list)).toEqual([second]);
    second.setAttribute('name', 'renamed');
    expect(list.length).toBe(0);
    expect(controls.namedItemOrItems('group')).toBeNull();
    expect(controls.namedItemOrItems('renamed')).toBe(second);
  });

  it('inherits HTMLCollection and NodeList behavior through real bindings', () => {
    const browser = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browser.window);
    const document = createTestDocument(realm.env);
    const root = document.createElement('root');
    for (let index = 0; index < 2; index++) {
      const input = document.createElementNS(HTML_NAMESPACE, 'input');
      input.setAttribute('name', 'group');
      root.appendChild(input);
    }
    const controls = new HTMLFormControlsCollectionImpl({ root, collect: () => [...root.children] });
    const platform = getBindingContext(realm).implToJS(controls, reference(HTMLFormControlsCollectionImpl)) as HTMLFormControlsCollection;
    const list = platform.namedItem('group') as RadioNodeList;
    const seen: number[] = [];
    list.forEach((_node, index) => seen.push(index));
    const first = platform[0]!;
    expect(browser.window.HTMLCollection.prototype.namedItem.call(platform, 'group')).toBe(first);
    expect(Reflect.get(platform, 'group')).toBeInstanceOf(browser.window.RadioNodeList);
    expect([
      platform instanceof browser.window.HTMLFormControlsCollection, platform instanceof browser.window.HTMLCollection,
      list instanceof browser.window.RadioNodeList, list instanceof browser.window.NodeList, platform.length,
      platform.item(0) === first, list.item(0) === first,
      Array.from(list).length, seen,
      Object.keys(platform), Object.getOwnPropertyDescriptor(platform, 'group')!.enumerable,
      Reflect.set(platform, '0', null), Reflect.deleteProperty(platform, '0'),
    ]).toEqual([true, true, true, true, 2, true, true, 2, [0, 1], ['0', '1'], false, false, false]);
    first.remove();
    expect([list.length, platform.namedItem('group') === platform[0]]).toEqual([1, true]);
  });

  it('uses radio state and internal checkedness, preserving absent versus empty value attributes', () => {
    const document = createTestDocument();
    const root = document.createElement('root');
    const checkbox = document.createElementNS(HTML_NAMESPACE, 'input');
    const first = document.createElementNS(HTML_NAMESPACE, 'input');
    const second = document.createElementNS(HTML_NAMESPACE, 'input');
    for (const input of [checkbox, first, second]) {
      input.setAttribute('name', 'group');
      root.appendChild(input);
    }
    checkbox.setAttribute('type', 'checkbox');
    checkbox.setAttribute('checked', '');
    first.setAttribute('type', 'RADIO');
    second.setAttribute('type', 'radio');
    second.setAttribute('value', '');
    const list = new RadioNodeListImpl({ root, collect: () => [...root.childNodes] });
    expect(list.value).toBe('');
    list.value = 'on';
    expect(list.value).toBe('on');
    if (!HTMLInputElementImpl.is(first) || !HTMLInputElementImpl.is(second)) throw new Error('Expected input implementations');
    expect(first.checkedness).toBe(true);
    expect(first.dirtyCheckedness).toBe(false);
    expect(first.getAttributeNS(null, 'checked')).toBeNull();
    first.setCheckedness(false);
    list.value = '';
    expect(second.checkedness).toBe(true);
    expect(list.value).toBe('');
    list.value = 'missing';
    expect(second.checkedness).toBe(true);
  });

  // Approved expected failure until form-owner association supplies collection membership.
  it.fails('includes controls associated from outside the form subtree', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const form = document.createElement('form');
      form.id = 'owner';
      const inside = document.createElement('input');
      const outside = document.createElement('input');
      outside.setAttribute('form', 'owner');
      form.append(inside);
      document.body.append(form, outside);
      return [form.elements.length, form.elements[0] === inside, form.elements[1] === outside];
    })).toEqual([2, true, true]);
  });

  // Approved expected failure until input checkedness updates enforce radio-group exclusion.
  it.fails('unchecks the previous member of a radio group when setting the list value', () => {
    const document = createTestDocument();
    const root = document.createElement('root');
    const first = document.createElementNS(HTML_NAMESPACE, 'input');
    const second = document.createElementNS(HTML_NAMESPACE, 'input');
    for (const input of [first, second]) {
      input.setAttribute('type', 'radio');
      input.setAttribute('name', 'group');
      root.appendChild(input);
    }
    first.setAttribute('value', 'first');
    second.setAttribute('value', 'second');
    first.setAttribute('checked', '');
    const list = new RadioNodeListImpl({ root, collect: () => [...root.childNodes] });
    list.value = 'second';
    expect(list.value).toBe('second');
  });
});
