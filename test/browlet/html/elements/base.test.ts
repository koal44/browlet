import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../../src/browlet/bindings';
import { ShadowRootImpl } from '../../../../src/browlet/dom/nodes/shadow-root';
import { parseURL } from '../../../../src/url/url';

describe('HTMLBaseElement', () => {
  it('exposes parsed and script-created base elements with reflected href and target', async () => {
    const browlet = new Browlet({ route: () => '<base href="../assets/" target="frame">' });
    await browlet.navigate('https://example.test/dir/page');
    const window = browlet.window as Window & typeof globalThis;
    const document = window.document;
    const base = document.getElementsByTagName('base')[0]!;
    expect(base).toBeInstanceOf(window.HTMLBaseElement);
    expect(base).toBeInstanceOf(window.HTMLElement);
    expect(base.href).toBe('https://example.test/assets/');
    expect(base.target).toBe('frame');
    expect(document.baseURI).toBe(base.href);
    expect(document.URL).toBe('https://example.test/dir/page');

    const detached = document.createElement('base');
    expect(detached).toBeInstanceOf(window.HTMLBaseElement);
    expect(detached.href).toBe(document.URL);
    expect(detached.target).toBe('');
    detached.href = 'relative/';
    detached.target = '_blank';
    expect(detached.getAttribute('href')).toBe('relative/');
    expect(detached.getAttribute('target')).toBe('_blank');
    expect(detached.href).toBe('https://example.test/dir/relative/');
    expect(document.baseURI).toBe(base.href);
    expect(() => new window.HTMLBaseElement()).toThrow(window.TypeError);
  });

  it('uses the first base with href and updates on attribute changes', () => {
    const { document, root } = createDocument();
    const first = document.createElement('base');
    first.target = 'frame';
    const second = document.createElement('base');
    second.href = '/second/';
    root.appendChild(first);
    root.appendChild(second);
    expect(document.baseURI).toBe('https://example.test/second/');

    first.href = 'first/';
    expect(document.baseURI).toBe('https://example.test/dir/first/');
    first.setAttribute('href', '/changed/');
    expect(document.baseURI).toBe('https://example.test/changed/');
    first.removeAttribute('href');
    expect(document.baseURI).toBe('https://example.test/second/');
    first.href = '';
    expect(document.baseURI).toBe(document.URL);
    expect(document.createTextNode('detached').baseURI).toBe(document.baseURI);
  });

  it('updates when bases or their containing subtrees are inserted, removed, and reordered', () => {
    const { document, root } = createDocument();
    const container = document.createElement('div');
    const first = document.createElement('base');
    first.href = '/first/';
    container.appendChild(first);
    const second = document.createElement('base');
    second.href = '/second/';
    root.appendChild(second);
    expect(document.baseURI).toBe('https://example.test/second/');

    root.insertBefore(container, second);
    expect(document.baseURI).toBe('https://example.test/first/');
    root.insertBefore(second, container);
    expect(document.baseURI).toBe('https://example.test/second/');
    second.remove();
    expect(document.baseURI).toBe('https://example.test/first/');
    container.remove();
    expect(document.baseURI).toBe(document.URL);
    root.appendChild(container);
    expect(document.baseURI).toBe('https://example.test/first/');
  });

  it('receives changes through Attr and NamedNodeMap as well as Element methods', async () => {
    const browlet = new Browlet({ route: () => '<base href="/first/">' });
    await browlet.navigate('https://example.test/page');
    const document = browlet.window.document;
    const base = document.getElementsByTagName('base')[0]!;
    const original = base.attributes.getNamedItem('href')!;
    original.value = '/changed/';
    expect(document.baseURI).toBe('https://example.test/changed/');

    const replacement = document.createAttribute('href');
    replacement.value = '/replacement/';
    expect(base.attributes.setNamedItem(replacement)).toBe(original);
    expect(document.baseURI).toBe('https://example.test/replacement/');
    original.value = '/detached/';
    expect(document.baseURI).toBe('https://example.test/replacement/');
    expect(base.attributes.removeNamedItemNS(null, 'href')).toBe(replacement);
    expect(document.baseURI).toBe(document.URL);
    base.attributes.setNamedItemNS(original);
    expect(document.baseURI).toBe('https://example.test/detached/');
  });

  it.each(['https://[', 'data:text/plain,content', 'javascript:1'])('falls back for %s without selecting a later base', (href) => {
    const { document, root } = createDocument();
    const first = document.createElement('base');
    first.href = href;
    const second = document.createElement('base');
    second.href = '/second/';
    root.appendChild(first);
    root.appendChild(second);
    expect(document.baseURI).toBe(document.URL);
    expect(first.href).toBe(href);
    first.remove();
    expect(document.baseURI).toBe('https://example.test/second/');
  });

  it('requires an HTML base element and a null-namespace href attribute', () => {
    const { document, root } = createDocument();
    const foreign = document.createElementNS('urn:example', 'base');
    foreign.setAttribute('href', '/foreign/');
    root.appendChild(foreign);
    const base = document.createElement('base');
    const namespaced = document.createAttributeNode('href', '/namespaced/', 'urn:example', null);
    base.attributes.setNamedItemNS(namespaced);
    root.appendChild(base);
    expect(document.baseURI).toBe(document.URL);
    expect(base.href).toBe(document.URL);

    base.href = '/ordinary/';
    expect(namespaced.value).toBe('/namespaced/');
    expect(base.getAttributeNS(null, 'href')).toBe('/ordinary/');
    expect(document.baseURI).toBe('https://example.test/ordinary/');
    namespaced.value = '/changed/';
    expect(document.baseURI).toBe('https://example.test/ordinary/');
  });

  it('ignores bases in detached and shadow trees', () => {
    const { document, root } = createDocument();
    const base = document.createElement('base');
    base.href = '/shadow/';
    const shadow = new ShadowRootImpl(root, 'open');
    shadow.appendChild(base);
    expect(base.isConnected).toBe(true);
    expect(document.baseURI).toBe(document.URL);
    base.href = '/changed/';
    expect(document.baseURI).toBe(document.URL);
    root.appendChild(base);
    expect(document.baseURI).toBe('https://example.test/changed/');
  });
});

describe('Frozen base URLs', () => {
  it('retains the selected URL when the document URL changes while href resolves against the new fallback', () => {
    const { document, root } = createDocument();
    const base = document.createElement('base');
    base.href = 'relative/';
    root.appendChild(base);
    document.url = parseURL('https://example.test/new/page').url!;
    expect(document.baseURI).toBe('https://example.test/dir/relative/');
    expect(base.href).toBe('https://example.test/new/relative/');

    base.setAttribute('href', 'relative/');
    expect(document.baseURI).toBe('https://example.test/new/relative/');
  });

  it('does not refresh the first base when later bases or unrelated attributes change', () => {
    const { document, root } = createDocument();
    const first = document.createElement('base');
    first.href = 'first/';
    root.appendChild(first);
    document.url = parseURL('https://example.test/new/page').url!;
    const second = document.createElement('base');
    second.href = 'second/';
    root.appendChild(second);
    second.href = 'changed/';
    first.target = 'frame';
    root.insertBefore(first, second);
    first.attributes.setNamedItem(first.attributes.getNamedItem('href')!);
    expect(document.baseURI).toBe('https://example.test/dir/first/');

    first.remove();
    expect(document.baseURI).toBe('https://example.test/new/changed/');
    root.insertBefore(first, second);
    expect(document.baseURI).toBe('https://example.test/new/first/');
  });

  it('freezes an invalid base to the fallback at selection time', () => {
    const { document, root } = createDocument();
    const base = document.createElement('base');
    base.href = 'https://[';
    root.appendChild(base);
    document.url = parseURL('https://example.test/new/page').url!;
    expect(document.baseURI).toBe('https://example.test/dir/page');
    base.attributes.getNamedItem('href')!.value = 'https://[';
    expect(document.baseURI).toBe('https://example.test/new/page');
  });
});

function createDocument() {
  const browlet = new Browlet({ route: () => '' });
  const document = getRelevantRealm(browlet.window).windowImplementation.getAssociatedDocument();
  document.url = parseURL('https://example.test/dir/page').url!;
  const root = document.documentElement!;
  return { document, root };
}
