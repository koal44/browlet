import { assert, describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { HTMLElementImpl } from '../../../../src/browlet/dom/nodes/html/html-element';
import { extractMicrodataJSON } from '../../../../src/browlet/html/microdata/index';
import { HTML_NAMESPACE, SVG_NAMESPACE } from '../../../../src/infra/index';
import { unwrap } from '../../../support/browlet-binding';
import { createTestDocument, parseTestDocument } from '../../../support/dom';

describe('Microdata property discovery', () => {
  it('returns property elements in tree order, preserving shared names and nested text properties', () => {
    const document = parseTestDocument(`
      <div id="item" itemscope>
        text <!-- not an element -->
        <div><span id="first" itemprop="a b a">one</span></div>
        <div id="second" itemprop="a"><b id="third" itemprop="b">two</b></div>
        <span id="empty" itemprop=" \t\n\f\r ">not a property</span>
      </div>
    `);
    const item = document.getElementById('item')!;
    assert(HTMLElementImpl.is(item));
    const result = item.getItemProperties();
    expect(result).toEqual({
      properties: ['first', 'second', 'third'].map((id) => document.getElementById(id)), hasError: false,
    });
    expect(result.properties.map((element) => element.getPropertyNames())).toEqual([['a', 'b'], ['a'], ['b']]);
    expect(result.properties.map((element) => element.getPropertyValue())).toEqual(['one', 'two', 'two']);
  });

  it('includes a nested item as a value but stops at every itemscope, even one without property names', () => {
    const document = parseTestDocument(`
      <div id="item" itemscope itemprop="not-its-own-property">
        <div id="nested" itemscope itemprop="child"><span id="inner" itemprop="name">Inner</span></div>
        <div itemscope><span itemprop="hidden">Hidden</span></div>
        <div itemscope itemprop=" "><span itemprop="also-hidden">Hidden</span></div>
        <span id="last" itemprop="name">Last</span>
      </div>
    `);
    expect(inspect(document.getElementById('item')!)).toEqual({ ids: ['nested', 'last'], hasError: false });
    const nested = document.getElementById('nested')!;
    assert(HTMLElementImpl.is(nested));
    expect(nested.getPropertyValue()).toBe(nested);
    expect(inspect(nested)).toEqual({ ids: ['inner'], hasError: false });
  });

  it('merges itemref targets and descendants in tree order rather than reference or discovery order', () => {
    const document = parseTestDocument(`
      <span id="before" itemprop="name">Before</span>
      <div id="item" itemscope itemref="after missing before">
        <span id="inside" itemprop="name">Inside</span>
      </div>
      <div id="after" itemprop="name"><span id="last" itemprop="name">Last</span></div>
    `);
    expect(inspect(document.getElementById('item')!)).toEqual({ ids: ['before', 'inside', 'after', 'last'], hasError: false });
  });

  it('allows two items to share a referenced property without sharing traversal memory', () => {
    const document = parseTestDocument(`
      <div id="a" itemscope itemref="license"></div>
      <div id="b" itemscope itemref="license"></div>
      <span id="license" itemprop="license">Shared</span>
    `);
    const first = document.getElementById('a')!;
    const second = document.getElementById('b')!;
    assert(HTMLElementImpl.is(first) && HTMLElementImpl.is(second));
    const a = first.getItemProperties();
    const b = second.getItemProperties();
    expect(a).toEqual({ properties: [document.getElementById('license')], hasError: false });
    expect(b).toEqual(a);
    expect(a.properties).not.toBe(b.properties);
  });

  it('uses only the root itemref, without following itemref on ordinary or referenced descendants', () => {
    const document = parseTestDocument(`
      <div id="item" itemscope itemref="external">
        <span id="child" itemprop="name" itemref="ignored">Child</span>
      </div>
      <span id="external" itemprop="name" itemref="ignored">External</span>
      <span id="ignored" itemprop="name">Ignored</span>
    `);
    expect(inspect(document.getElementById('item')!)).toEqual({ ids: ['child', 'external'], hasError: false });
  });

  it('selects the first matching ID without requiring it to be a property, and does not match names or case variants', () => {
    const document = parseTestDocument(`
      <div id="item" itemscope itemref="duplicate TARGET named"></div>
      <div id="duplicate"><span id="first" itemprop="name">First</span></div>
      <span id="duplicate" itemprop="name">Second</span>
      <span id="target" itemprop="name">Lowercase</span>
      <a name="named" itemprop="name">Name only</a>
    `);
    expect(inspect(document.getElementById('item')!)).toEqual({ ids: ['first'], hasError: false });
  });

  it('splits itemref on ASCII whitespace without treating IDs as selectors or splitting non-ASCII spaces', () => {
    const document = parseTestDocument('<div id="item" itemscope></div><span id="a:b" itemprop="name"></span><span id="two\u00a0words" itemprop="\u00a0"></span>');
    const item = document.getElementById('item')!;
    item.setAttribute('itemref', ' \t two\u00a0words\n\f\r a:b ');
    expect(inspect(item)).toEqual({ ids: ['a:b', 'two\u00a0words'], hasError: false });
  });

  it('does not discover properties for a non-item or follow its itemref', () => {
    const document = parseTestDocument('<div id="item" itemref="outside"><span itemprop="name"></span></div><span id="outside" itemprop="name"></span>');
    expect(inspect(document.getElementById('item')!)).toEqual({ ids: [], hasError: false });
    const foreign = document.createElementNS(SVG_NAMESPACE, 'svg');
    foreign.setAttribute('itemscope', '');
    foreign.setAttribute('itemref', 'outside');
    expect(extractMicrodataJSON([foreign])).toBe('{"items":[]}');
  });
});

describe('Microdata traversal errors', () => {
  it.each([
    ['repeated itemref tokens', '<div id="item" itemscope itemref="p p"></div><span id="p" itemprop="name"></span>', ['p']],
    ['a child also referenced by itemref', '<div id="item" itemscope itemref="p"><span id="p" itemprop="name"></span></div>', ['p']],
    ['overlapping referenced subtrees', '<div id="item" itemscope itemref="group p"></div><div id="group"><span id="p" itemprop="name"></span></div>', ['p']],
    ['a reference to the item itself', '<div id="item" itemscope itemprop="self" itemref="item"><span id="p" itemprop="name"></span></div>', ['p']],
    ['a reference to an ancestor', '<div id="ancestor" itemprop="ancestor"><div id="item" itemscope itemref="ancestor"><span id="p" itemprop="name"></span></div></div>', ['ancestor', 'p']],
    ['a repeated element without properties', '<div id="item" itemscope itemref="empty empty"></div><div id="empty"></div>', []],
  ])('flags %s while returning each discovered property once', (_name, source, ids) => {
    const document = parseTestDocument(source);
    expect(inspect(document.getElementById('item')!)).toEqual({ ids, hasError: true });
  });

  it('does not confuse cycles between item values with revisiting elements during one discovery', () => {
    const document = parseTestDocument('<div id="a" itemscope itemprop="a" itemref="b"></div><div id="b" itemscope itemprop="b" itemref="a"></div>');
    // Each traversal stops at the other itemscope. Recursive JSON extraction must handle the value cycle separately.
    expect(inspect(document.getElementById('a')!)).toEqual({ ids: ['b'], hasError: false });
    expect(inspect(document.getElementById('b')!)).toEqual({ ids: ['a'], hasError: false });
  });
});

describe('Microdata tree and namespace boundaries', () => {
  it('includes a detached tree root in itemref lookup', () => {
    const document = parseTestDocument('<div id="tree" itemprop="ancestor"><div id="item" itemscope itemref="tree"></div></div>');
    const tree = document.getElementById('tree')!;
    const item = document.getElementById('item')!;
    tree.remove();
    expect(inspect(item)).toEqual({ ids: ['tree'], hasError: true });
  });

  it('searches only the current tree when detached, moved into a fragment, or adopted', () => {
    const document = parseTestDocument('<div id="item" itemscope itemref="p"></div><span id="p" itemprop="name"></span>');
    const item = document.getElementById('item')!;
    assert(HTMLElementImpl.is(item));
    const originalProperty = document.getElementById('p')!;
    item.remove();
    expect(inspect(item)).toEqual({ ids: [], hasError: false });
    const fragment = document.createDocumentFragment();
    fragment.appendChild(item);
    fragment.appendChild(originalProperty);
    expect(item.getItemProperties().properties).toEqual([originalProperty]);

    const target = parseTestDocument('<span id="p" itemprop="new-name">New document</span>');
    const newProperty = target.getElementById('p')!;
    target.body!.appendChild(item);
    expect(item.getItemProperties().properties).toEqual([newProperty]);
  });

  it('ignores foreign Microdata attributes without skipping HTML descendants or foreign ID targets', () => {
    const document = createTestDocument();
    const tree = document.createElementNS(HTML_NAMESPACE, 'div');
    const item = document.createElementNS(HTML_NAMESPACE, 'section');
    assert(HTMLElementImpl.is(item));
    item.setAttribute('itemscope', '');
    item.setAttribute('itemref', 'foreign');
    tree.appendChild(item);
    const foreign = document.createElementNS(SVG_NAMESPACE, 'svg');
    foreign.setAttribute('id', 'foreign');
    foreign.setAttribute('itemscope', '');
    foreign.setAttribute('itemprop', 'ignored');
    tree.appendChild(foreign);
    const child = document.createElementNS(HTML_NAMESPACE, 'span');
    child.setAttribute('id', 'child');
    child.setAttribute('itemprop', 'name');
    foreign.appendChild(child);
    expect(inspect(item)).toEqual({ ids: ['child'], hasError: false });

    child.removeAttribute('itemprop');
    child.setAttributeNS('urn:example', 'itemprop', 'ignored');
    expect(inspect(item)).toEqual({ ids: [], hasError: false });
  });

  it('ignores namespaced itemscope and itemref lookalikes', () => {
    const document = parseTestDocument('<div id="item" itemscope><div id="middle"><span id="p" itemprop="name"></span></div></div><span id="outside" itemprop="name"></span>');
    const item = document.getElementById('item')!;
    document.getElementById('middle')!.setAttributeNS('urn:example', 'itemscope', '');
    item.setAttributeNS('urn:example', 'itemref', 'outside');
    expect(inspect(item)).toEqual({ ids: ['p'], hasError: false });
  });

  it('keeps document and shadow-tree references separate without traversing shadow contents', async () => {
    const browser = new Browlet({ route: () => '<div id="item" itemscope itemref="shadow-only"><span id="p" itemprop="name"></span><div id="host"></div></div>' });
    await browser.navigate('https://example.test/');
    await browser.evaluate(() => {
      const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
      const item = document.createElement('div');
      item.setAttribute('id', 'shadow-item');
      item.setAttribute('itemscope', '');
      item.setAttribute('itemref', 'p item');
      const property = document.createElement('span');
      property.setAttribute('id', 'p');
      property.setAttribute('itemprop', 'name');
      const hidden = document.createElement('span');
      hidden.setAttribute('id', 'shadow-only');
      hidden.setAttribute('itemprop', 'hidden');
      shadow.append(item, property, hidden);
    });
    const item = unwrap<HTMLElementImpl>(browser.document.getElementById('item')!);
    const shadowItem = unwrap<HTMLElementImpl>(browser.document.getElementById('host')!.shadowRoot!.getElementById('shadow-item')!);
    expect(inspect(item)).toEqual({ ids: ['p'], hasError: false });
    const shadowProperties = shadowItem.getItemProperties();
    expect(shadowProperties.hasError).toBe(false);
    expect(shadowProperties.properties.map((element) => element.getAttribute('id'))).toEqual(['p']);
    expect(shadowProperties.properties[0]).not.toBe(item.getItemProperties().properties[0]);
  });

  it.fails('excludes template contents from descendant discovery and itemref lookup', () => {
    // Chapter 4/parser dependency: setTemplateContent currently throws before discovery can run.
    const document = parseTestDocument('<div id="item" itemscope itemref="hidden"><span id="visible" itemprop="name"></span><template><span id="hidden" itemprop="name"></span></template></div>');
    expect(inspect(document.getElementById('item')!)).toEqual({ ids: ['visible'], hasError: false });
  });
});

describe('Microdata mutations and top-level items', () => {
  it('returns fresh snapshots after author mutations to names, scopes, IDs, references, and tree order', async () => {
    const browser = new Browlet({ route: () => '<div id="item" itemscope itemref="outside"><span id="a" itemprop="name"></span><div id="b"><span id="c" itemprop="name"></span></div></div><span id="outside" itemprop="name"></span>' });
    await browser.navigate('https://example.test/');
    const item = unwrap<HTMLElementImpl>(browser.document.getElementById('item')!);
    const oldProperties = item.getItemProperties().properties;
    expect(inspect(item)).toEqual({ ids: ['a', 'c', 'outside'], hasError: false });
    await browser.evaluate(() => {
      const item = document.getElementById('item')!;
      const a = document.getElementById('a')!;
      const b = document.getElementById('b')!;
      a.setAttribute('itemprop', ' ');
      b.setAttribute('itemscope', '');
      b.setAttribute('itemprop', 'nested');
      document.getElementById('outside')!.setAttribute('id', 'renamed');
      item.setAttribute('itemref', 'renamed');
      item.parentNode!.insertBefore(document.getElementById('renamed')!, item);
    });
    expect(inspect(item)).toEqual({ ids: ['renamed', 'b'], hasError: false });
    expect(oldProperties.map((element) => element.getAttribute('id'))).toEqual(['a', 'c', 'renamed']);
    oldProperties.length = 0;
    expect(inspect(item)).toEqual({ ids: ['renamed', 'b'], hasError: false });
  });

  it('defines top-level by itemprop presence rather than ancestry or discovery by another item', () => {
    const document = parseTestDocument('<div id="outer" itemscope><div id="inner" itemscope></div><span id="ordinary"></span></div><div id="orphan" itemscope itemprop=""></div>');
    const inner = document.getElementById('inner')!;
    assert(HTMLElementImpl.is(inner));
    for (const [id, expected] of [['outer', true], ['ordinary', false], ['orphan', false]] as const) {
      const element = document.getElementById(id);
      assert(HTMLElementImpl.is(element));
      expect(element.isTopLevelMicrodataItem()).toBe(expected);
    }
    expect(inner.isTopLevelMicrodataItem()).toBe(true);
    inner.setAttributeNS('urn:example', 'itemprop', 'ignored');
    expect(inner.isTopLevelMicrodataItem()).toBe(true);
    inner.setAttributeNS(null, 'itemprop', ' ');
    expect(inner.isTopLevelMicrodataItem()).toBe(false);
    inner.removeAttributeNS(null, 'itemprop');
    expect(inner.isTopLevelMicrodataItem()).toBe(true);
    const foreign = document.createElementNS(SVG_NAMESPACE, 'svg');
    foreign.setAttribute('itemscope', '');
    expect(extractMicrodataJSON([foreign])).toBe('{"items":[]}');
  });
});

function inspect(item: ElementImpl): { ids: (string | null)[]; hasError: boolean; } {
  assert(HTMLElementImpl.is(item));
  const { properties, hasError } = item.getItemProperties();
  return { ids: properties.map((element) => element.getAttribute('id')), hasError };
}
