import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';

describe('Node namespace lookup', () => {
  it('resolves names, declarations, and ancestor overrides from each node context', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const xmlns = 'http://www.w3.org/2000/xmlns/';
      const xml = document.implementation.createDocument('urn:root', 'p:root');
      const root = xml.documentElement;
      root.setAttributeNS(xmlns, 'xmlns:q', 'urn:q');
      root.setAttributeNS(xmlns, 'xmlns', 'urn:default');
      const child = root.appendChild(xml.createElement('child'));
      const text = child.appendChild(xml.createTextNode('text'));
      child.setAttribute('attr', 'value');
      const attribute = child.getAttributeNode('attr')!;
      const before = [xml.lookupPrefix('urn:root'), text.lookupPrefix('urn:q'),
        attribute.lookupNamespaceURI('p'), child.lookupNamespaceURI(null), child.isDefaultNamespace('urn:default')];
      child.setAttributeNS(xmlns, 'xmlns:q', 'urn:override');
      child.setAttributeNS(xmlns, 'xmlns', '');
      return [before, text.lookupNamespaceURI('q'), text.lookupNamespaceURI(''),
        text.isDefaultNamespace(null), root.lookupNamespaceURI('xml'), root.lookupNamespaceURI('xmlns'),
        xml.createDocumentFragment().lookupNamespaceURI('p'), xml.createAttribute('a').lookupPrefix('urn:q')];
    })).toEqual([
      ['p', 'q', 'urn:root', 'urn:default', true], 'urn:override', null, true,
      'http://www.w3.org/XML/1998/namespace', 'http://www.w3.org/2000/xmlns/', null, null,
    ]);
  });

  it('does not cross a shadow root when resolving namespaces', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      host.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:p', 'urn:p');
      const shadow = host.attachShadow({ mode: 'open' });
      const child = shadow.appendChild(document.createElementNS(null, 'child'));
      return [host.lookupNamespaceURI('p'), shadow.lookupNamespaceURI('p'), child.lookupNamespaceURI('p')];
    })).toEqual(['urn:p', null, null]);
  });
});
