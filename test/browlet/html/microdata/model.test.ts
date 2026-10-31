import { assert, describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { HTMLElementImpl } from '../../../../src/browlet/dom/nodes/html/html-element';
import { extractMicrodataJSON } from '../../../../src/browlet/html/microdata/index';
import { HTML_NAMESPACE, SVG_NAMESPACE, MATHML_NAMESPACE } from '../../../../src/infra/index';
import { parseURL, serializeURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';
import { createTestDocument, parseTestDocument } from '../../../support/dom';

describe('Microdata items', () => {
  it.each(['', 'itemscope', 'false'])('treats itemscope=%j as present, including on a detached element', (value) => {
    const element = createTestDocument().createElementNS(HTML_NAMESPACE, 'section');
    assert(HTMLElementImpl.is(element));
    expect(element.isMicrodataItem()).toBe(false);
    element.setAttribute('itemscope', value);
    expect(element.isMicrodataItem()).toBe(true);
    element.removeAttribute('itemscope');
    expect(element.isMicrodataItem()).toBe(false);
  });

  it.each([SVG_NAMESPACE, MATHML_NAMESPACE, 'urn:example', null])('ignores microdata on elements in namespace %j', (namespace) => {
    const element = createTestDocument().createElementNS(namespace, 'item');
    element.setAttribute('itemscope', '');
    element.setAttribute('itemtype', 'https://example.test/Type');
    element.setAttribute('itemid', 'urn:example:item');
    element.setAttribute('itemprop', 'name');
    const item = createItem();
    item.appendChild(element);
    expect(item.getItemProperties()).toEqual({ properties: [], hasError: false });
    element.removeAttribute('itemprop');
    expect(extractMicrodataJSON([element])).toBe('{"items":[]}');
  });

  it('ignores namespaced lookalike attributes and uses exact local names in XML', () => {
    const element = createTestDocument().createElementNS(HTML_NAMESPACE, 'h:section');
    assert(HTMLElementImpl.is(element));
    // Qualified-name lookup alone would mistake these for HTML's namespace-less attributes.
    element.setAttributeNS('urn:example', 'itemscope', '');
    element.setAttributeNS('urn:example', 'itemtype', 'https://example.test/Type');
    element.setAttributeNS('urn:example', 'itemid', 'urn:example:item');
    element.setAttributeNS('urn:example', 'itemprop', 'name');
    element.setAttribute('ITEMSCOPE', '');
    expect(element.isMicrodataItem()).toBe(false);

    element.setAttributeNS(null, 'itemscope', '');
    expect(element.isMicrodataItem()).toBe(true);
    expect(element.getItemTypes()).toEqual([]);
    expect(element.getItemGlobalIdentifier()).toBeNull();
    expect(element.getPropertyNames()).toEqual([]);
  });

  it('recognizes the introduction\'s parsed items without treating their property elements as items', () => {
    const document = parseTestDocument(`
      <div id="first" itemscope><span id="name" itemprop="name">Elizabeth</span></div>
      <section><div id="second" itemscope><span itemprop="name">Daniel</span></div></section>
    `);
    for (const id of ['first', 'second']) {
      const item = document.getElementById(id);
      assert(HTMLElementImpl.is(item));
      expect(item.isMicrodataItem()).toBe(true);
    }
    const name = document.getElementById('name')!;
    assert(HTMLElementImpl.is(name));
    expect(name.isMicrodataItem()).toBe(false);
    expect(name.getPropertyNames()).toEqual(['name']);
  });
});

describe('Microdata item types', () => {
  it('requires an item and treats missing, empty, and ASCII-whitespace-only attributes as no types', () => {
    const element = createItem();
    expect(element.getItemTypes()).toEqual([]);
    for (const value of ['', ' \t\n\f\r']) {
      element.setAttribute('itemtype', value);
      expect(element.getItemTypes()).toEqual([]);
    }
    element.setAttribute('itemtype', 'https://example.test/Type');
    element.removeAttribute('itemscope');
    expect(element.getItemTypes()).toEqual([]);
  });

  it('splits ASCII whitespace while retaining duplicate, case-sensitive, opaque tokens', () => {
    const element = createItem();
    element.setAttribute('itemtype', ' \tHTTPS://EXAMPLE.test/Type\nrelative\frelative\rType\u00a0Suffix Type\vSuffix ');
    expect(element.getItemTypes()).toEqual([
      'HTTPS://EXAMPLE.test/Type', 'relative', 'relative', 'Type\u00a0Suffix', 'Type\vSuffix',
    ]);
  });

  it('reads current attributes and does not let a caller mutate the stored type names', () => {
    const element = createItem();
    element.setAttribute('itemtype', 'urn:example:one');
    const types = element.getItemTypes();
    types.push('urn:example:extra');
    expect(element.getItemTypes()).toEqual(['urn:example:one']);
    element.setAttribute('itemtype', 'urn:example:two');
    expect(element.getItemTypes()).toEqual(['urn:example:two']);
    element.removeAttribute('itemtype');
    expect(element.getItemTypes()).toEqual([]);
  });
});

describe('Microdata global identifiers', () => {
  it('distinguishes a missing or invalid identifier from a present empty one', () => {
    const element = createItem();
    expect(element.getItemGlobalIdentifier()).toBeNull();
    element.setAttribute('itemid', 'https://[');
    expect(element.getItemGlobalIdentifier()).toBeNull();
    element.setAttribute('itemid', '');
    expect(serializeURL(element.getItemGlobalIdentifier()!)).toBe('https://example.test/dir/page');
    element.removeAttribute('itemscope');
    expect(element.getItemGlobalIdentifier()).toBeNull();
  });

  it('reads identifiers without requiring a known vocabulary or rejecting nonconforming authoring', () => {
    const element = createItem();
    element.setAttribute('itemid', 'urn:isbn:0-330-34032-8');
    expect(serializeURL(element.getItemGlobalIdentifier()!)).toBe('urn:isbn:0-330-34032-8');
    element.setAttribute('itemtype', 'unknown-vocabulary');
    element.setAttribute('itemid', ' \t../a b\n');
    expect(serializeURL(element.getItemGlobalIdentifier()!)).toBe('https://example.test/a%20b');
  });

  it('uses the node document\'s encoding for the query and UTF-8 for the path', () => {
    const element = createItem();
    element.nodeDocument.encoding = 'windows-1252';
    element.setAttribute('itemid', 'café?q=é#é');
    expect(serializeURL(element.getItemGlobalIdentifier()!)).toBe('https://example.test/dir/caf%C3%A9?q=%E9#%C3%A9');
    element.nodeDocument.encoding = 'UTF-8';
    expect(serializeURL(element.getItemGlobalIdentifier()!)).toBe('https://example.test/dir/caf%C3%A9?q=%C3%A9#%C3%A9');
  });

  it('follows base changes and adoption instead of retaining the first parsed identifier', () => {
    const element = createItem();
    const document = element.nodeDocument;
    const base = document.createElementNS(HTML_NAMESPACE, 'base');
    base.setAttribute('href', 'https://assets.test/one/');
    document.appendChild(base);
    element.setAttribute('itemid', 'book');
    const original = element.getItemGlobalIdentifier()!;
    expect(serializeURL(original)).toBe('https://assets.test/one/book');

    base.setAttribute('href', '/two/');
    expect(serializeURL(element.getItemGlobalIdentifier()!)).toBe('https://example.test/two/book');
    expect(serializeURL(original)).toBe('https://assets.test/one/book');

    const otherDocument = createTestDocument(document.env);
    otherDocument.url = parseURL('https://other.test/after-adoption/').url!;
    otherDocument.adoptNode(element);
    expect(serializeURL(element.getItemGlobalIdentifier()!)).toBe('https://other.test/after-adoption/book');
  });
});

describe('Microdata property names', () => {
  it('uses ASCII whitespace and removes exact duplicates while preserving first-occurrence order', () => {
    const element = createItem();
    element.removeAttribute('itemscope'); // Property elements need not themselves create items.
    element.setAttribute('itemprop', ' \tname\nhttps://example.test/name\fname\rName name\u00a0part name\vpart ');
    expect(element.getPropertyNames()).toEqual([
      'name', 'https://example.test/name', 'Name', 'name\u00a0part', 'name\vpart',
    ]);
  });

  it('does not filter names by vocabulary conformance and follows attribute changes', () => {
    const element = createItem();
    expect(element.getPropertyNames()).toEqual([]);
    element.setAttribute('itemprop', 'a.b a:b name');
    const names = element.getPropertyNames();
    expect(names).toEqual(['a.b', 'a:b', 'name']);
    names.length = 0;
    expect(element.getPropertyNames()).toEqual(['a.b', 'a:b', 'name']);
    element.setAttribute('itemprop', 'changed');
    expect(element.getPropertyNames()).toEqual(['changed']);
    element.setAttribute('itemprop', ' \t\n\f\r');
    expect(element.getPropertyNames()).toEqual([]);
    element.removeAttribute('itemprop');
    expect(element.getPropertyNames()).toEqual([]);
  });

  it('observes author changes through ordinary DOM bindings without introducing Microdata interfaces', async () => {
    const browser = new Browlet({ route: () => '<div id="item" itemscope itemprop="name"></div>' });
    await browser.navigate('https://example.test/');
    const element = unwrap<HTMLElementImpl>(browser.document.getElementById('item')!);
    expect(element.getPropertyNames()).toEqual(['name']);
    await browser.evaluate(() => {
      const item = document.getElementById('item')!;
      item.setAttribute('itemprop', 'title name title');
      item.setAttribute('itemtype', 'urn:example:Book');
      item.setAttribute('itemid', '/books/1');
    });
    expect(element.getPropertyNames()).toEqual(['title', 'name']);
    expect(element.getItemTypes()).toEqual(['urn:example:Book']);
    expect(serializeURL(element.getItemGlobalIdentifier()!)).toBe('https://example.test/books/1');
  });
});

function createItem(): HTMLElementImpl {
  const document = createTestDocument();
  document.url = parseURL('https://example.test/dir/page').url!;
  const element = document.createElementNS(HTML_NAMESPACE, 'section');
  assert(HTMLElementImpl.is(element));
  element.setAttribute('itemscope', '');
  return element;
}
