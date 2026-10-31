import { assert, describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl, ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { HTMLElementImpl } from '../../../../src/browlet/dom/nodes/html/html-element';
import { HTMLTimeElementImpl } from '../../../../src/browlet/dom/nodes/html/text/time';
import { HTML_NAMESPACE, SVG_NAMESPACE, MATHML_NAMESPACE } from '../../../../src/infra/index';
import { parseURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';
import { createTestDocument } from '../../../support/dom';

describe('Microdata property values', () => {
  it.each(['span', 'meta', 'data', 'meter', 'time', 'img'])('returns a nested %s item before applying its string-value rules', (name) => {
    const element = createProperty(name);
    element.setAttribute('itemscope', 'false');
    expect(element.getPropertyValue()).toBe(element);
  });

  it.each([['meta', 'content'], ['data', 'value'], ['meter', 'value']])('reads %s[%s] literally, including absent and empty values', (name, attribute) => {
    const element = createProperty(name);
    element.textContent = 'visible text';
    expect(element.getPropertyValue()).toBe('');
    element.setAttributeNS('urn:example', `x:${attribute}`, 'namespaced');
    expect(element.getPropertyValue()).toBe('');
    element.setAttribute(attribute, ' \t001.50\n');
    expect(element.getPropertyValue()).toBe(' \t001.50\n');
    element.setAttribute(attribute, 'not a number');
    expect(element.getPropertyValue()).toBe('not a number');
    element.setAttribute(attribute, '');
    expect(element.getPropertyValue()).toBe('');
    element.removeAttribute(attribute);
    expect(element.getPropertyValue()).toBe('');
  });

  it('uses descendant text for ordinary elements without normalizing or interpreting it as a URL', () => {
    const element = createProperty('span');
    const document = element.nodeDocument;
    element.appendChild(document.createTextNode(' https://'));
    const nested = document.createElementNS(HTML_NAMESPACE, 'strong');
    nested.setAttribute('itemscope', '');
    nested.textContent = 'example.test/';
    element.appendChild(nested);
    element.appendChild(document.createComment('ignored'));
    element.appendChild(document.createTextNode('path\n'));
    expect(element.getPropertyValue()).toBe(' https://example.test/path\n');
    nested.textContent = 'changed/';
    expect(element.getPropertyValue()).toBe(' https://changed/path\n');
  });

  it('ignores foreign elements and namespaced itemprop, while allowing an empty itemprop value', () => {
    const document = createDocument();
    const item = createProperty('div');
    item.setAttribute('itemscope', '');
    for (const namespace of [SVG_NAMESPACE, MATHML_NAMESPACE, 'urn:example', null]) {
      const element = document.createElementNS(namespace, 'meta');
      element.setAttribute('itemprop', 'name');
      element.textContent = 'foreign';
      item.appendChild(element);
      expect(item.getItemProperties().properties).toEqual([]);
    }
    const element = document.createElementNS(HTML_NAMESPACE, 'span');
    assert(HTMLElementImpl.is(element));
    element.textContent = 'value';
    element.setAttributeNS('urn:example', 'x:itemprop', 'name');
    expect(element.getPropertyValue()).toBeNull();
    element.setAttributeNS(null, 'itemprop', '');
    expect(element.getPropertyValue()).toBe('value');
    element.removeAttribute('itemprop');
    expect(element.getPropertyValue()).toBeNull();
  });

  it('uses exact HTML local names in XML documents', () => {
    const element = createProperty('META');
    element.setAttribute('content', 'not metadata');
    element.textContent = 'ordinary text';
    expect(element.getPropertyValue()).toBe('ordinary text');
  });
});

describe('Time element datetime values', () => {
  it('uses direct child text rather than descendant text when datetime is absent', () => {
    const element = createProperty('time');
    assert(element instanceof HTMLTimeElementImpl);
    const document = element.nodeDocument;
    element.appendChild(document.createTextNode(' 2026-'));
    const nested = document.createElementNS(HTML_NAMESPACE, 'span');
    nested.textContent = 'ignored';
    element.appendChild(nested);
    element.appendChild(document.createComment('also ignored'));
    element.appendChild(document.createTextNode('10 '));
    expect(element.getDatetimeValue()).toBe(' 2026-10 ');
    expect(element.getPropertyValue()).toBe(' 2026-10 ');

    element.setAttributeNS('urn:example', 'x:datetime', 'not the datetime attribute');
    expect(element.getPropertyValue()).toBe(' 2026-10 ');
    element.setAttribute('datetime', 'not a valid date');
    expect(element.getPropertyValue()).toBe('not a valid date');
    element.setAttribute('datetime', '');
    expect(element.getPropertyValue()).toBe('');
    element.removeAttribute('datetime');
    expect(element.getPropertyValue()).toBe(' 2026-10 ');
  });
});

describe('Microdata URL property values', () => {
  it.each([
    ['audio', 'src'], ['embed', 'src'], ['iframe', 'src'], ['img', 'src'],
    ['source', 'src'], ['track', 'src'], ['video', 'src'],
    ['a', 'href'], ['area', 'href'], ['link', 'href'], ['object', 'data'],
  ])('uses the namespace-less %s[%s] attribute and returns an empty string for absence or parse failure', (name, attribute) => {
    const element = createProperty(name);
    element.textContent = 'not a fallback';
    expect(element.getPropertyValue()).toBe('');
    element.setAttributeNS('urn:example', `x:${attribute}`, 'ignored');
    expect(element.getPropertyValue()).toBe('');
    element.setAttribute(attribute, '../target?q=é');
    expect(element.getPropertyValue()).toBe('https://example.test/target?q=%C3%A9');
    element.setAttribute(attribute, '');
    expect(element.getPropertyValue()).toBe('https://example.test/dir/page');
    element.setAttribute(attribute, 'https://[');
    expect(element.getPropertyValue()).toBe('');
    expect(element.getAttribute(attribute)).toBe('https://[');
    element.removeAttribute(attribute);
    expect(element.getPropertyValue()).toBe('');
  });

  it('retains the URL set before itemprop existed and ignores later base or itemprop changes', () => {
    const document = createDocument();
    const base = addBase(document, 'https://first.test/one/');
    const element = document.createElementNS(HTML_NAMESPACE, 'a');
    assert(HTMLElementImpl.is(element));
    element.setAttribute('href', 'book');
    base.setAttribute('href', 'https://second.test/two/');
    element.setAttribute('itemprop', 'url');
    expect(element.getPropertyValue()).toBe('https://first.test/one/book');

    element.removeAttribute('itemprop');
    element.setAttribute('title', 'unrelated');
    element.setAttribute('itemprop', 'other-name');
    expect(element.getPropertyValue()).toBe('https://first.test/one/book');
    element.setAttribute('itemscope', '');
    expect(element.getPropertyValue()).toBe(element);
    element.removeAttribute('itemscope');
    expect(element.getPropertyValue()).toBe('https://first.test/one/book');

    element.setAttribute('href', 'book'); // Setting the same text again is still a new attribute-set time.
    expect(element.getPropertyValue()).toBe('https://second.test/two/book');
  });

  it('captures the document encoding when set and refreshes through Attr.value', () => {
    const element = createProperty('a');
    const document = element.nodeDocument;
    document.encoding = 'windows-1252';
    const value = 'café?q=é#é';
    element.setAttribute('href', value);
    expect(element.getPropertyValue()).toBe('https://example.test/dir/caf%C3%A9?q=%E9#%C3%A9');
    document.encoding = 'UTF-8';
    expect(element.getPropertyValue()).toBe('https://example.test/dir/caf%C3%A9?q=%E9#%C3%A9');
    const attribute = element.getAttributeNodeNS(null, 'href')!;
    attribute.value = value;
    expect(element.getPropertyValue()).toBe('https://example.test/dir/caf%C3%A9?q=%C3%A9#%C3%A9');
  });

  it('captures a detached Attr when attached or replaced, and clears the URL when removed', () => {
    const element = createProperty('a');
    const document = element.nodeDocument;
    const attribute = document.createAttribute('href');
    attribute.value = 'first';
    const base = addBase(document, 'https://attached.test/');
    element.setAttributeNode(attribute);
    expect(element.getPropertyValue()).toBe('https://attached.test/first');
    base.setAttribute('href', 'https://replaced.test/');
    const replacement = document.createAttribute('href');
    replacement.value = 'second';
    element.attributes.setNamedItem(replacement);
    expect(element.getPropertyValue()).toBe('https://replaced.test/second');
    element.removeAttributeNode(replacement);
    expect(element.getPropertyValue()).toBe('');
    replacement.value = 'third';
    expect(element.getPropertyValue()).toBe('');
    element.setAttributeNode(replacement);
    expect(element.getPropertyValue()).toBe('https://replaced.test/third');
  });

  it('preserves a URL during adoption but reparses when cloned into a new document', () => {
    const element = createProperty('a');
    element.setAttribute('href', 'book');
    const originalURL = 'https://example.test/dir/book';
    const targetDocument = createDocument('https://target.test/library/');
    const imported = targetDocument.importNode(element, false);
    assert(HTMLElementImpl.is(imported));
    expect(imported.getPropertyValue()).toBe('https://target.test/library/book');

    targetDocument.adoptNode(element);
    expect(element.getPropertyValue()).toBe(originalURL);
    const cloned = element.cloneNode(false);
    assert(HTMLElementImpl.is(cloned));
    expect(cloned.getPropertyValue()).toBe('https://target.test/library/book');
    element.setAttribute('href', 'book');
    expect(element.getPropertyValue()).toBe('https://target.test/library/book');
  });

  it('captures parser-created attributes and later author mutations through normal DOM bindings', async () => {
    const browser = new Browlet({ route: () => '<a id="link" href="book" itemprop="url">Book</a>' });
    await browser.navigate('https://example.test/dir/page');
    const element = unwrap<HTMLElementImpl>(browser.document.getElementById('link')!);
    expect(element.getPropertyValue()).toBe('https://example.test/dir/book');
    await browser.evaluate(() => {
      const base = document.createElement('base');
      base.setAttribute('href', 'https://changed.test/');
      document.head.appendChild(base);
    });
    expect(element.getPropertyValue()).toBe('https://example.test/dir/book');
    await browser.evaluate(() => {
      document.getElementById('link')!.getAttributeNode('href')!.value = 'new-book';
    });
    expect(element.getPropertyValue()).toBe('https://changed.test/new-book');
  });
});

function createProperty(name: string): HTMLElementImpl {
  const element = createDocument().createElementNS(HTML_NAMESPACE, name);
  assert(HTMLElementImpl.is(element));
  element.setAttribute('itemprop', 'value');
  return element;
}

function createDocument(url = 'https://example.test/dir/page'): DocumentImpl {
  const document = createTestDocument();
  document.url = parseURL(url).url!;
  return document;
}

function addBase(document: DocumentImpl, href: string): ElementImpl {
  const base = document.createElementNS(HTML_NAMESPACE, 'base');
  base.setAttribute('href', href);
  document.appendChild(base);
  return base;
}
