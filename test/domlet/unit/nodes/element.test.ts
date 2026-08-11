import { describe, expect, it } from 'vitest';

import { Attribute } from '../../../../src/domlet/nodes/attribute';
import { Document } from '../../../../src/domlet/nodes/document';
import {
  Element, HTMLElement, HTMLLinkElement, HTMLStyleElement,
  MathMLElement, SVGElement, SVGStyleElement,
  HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE,
  isHTMLElement, isHTMLLinkElement, isHTMLStyleElement,
  isMathMLElement, isSVGElement, isSVGStyleElement,
} from '../../../../src/domlet/nodes/element';

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';

describe('Element attributes', () => {
  it('looks up unnamespaced attributes by qualified name', () => {
    const element = new Element('main', HTML_NAMESPACE, [
      new Attribute('id', 'content'),
      new Attribute('class', ''),
    ]);

    expect(element.getAttribute('id')).toBe('content');
    expect(element.getAttribute('missing')).toBeNull();
    expect(element.hasAttribute('class')).toBe(true);
    expect(element.hasAttribute('missing')).toBe(false);
  });

  it('looks up namespaced attributes by namespace and local name', () => {
    const element = new Element('main', HTML_NAMESPACE, [
      new Attribute('lang', 'en', XML_NAMESPACE, 'xml'),
      new Attribute('plain', 'value'),
    ]);

    expect(element.getAttribute('xml:lang')).toBe('en');
    expect(element.getAttributeNS(XML_NAMESPACE, 'lang')).toBe('en');
    expect(element.getAttributeNS(null, 'plain')).toBe('value');
    expect(element.getAttributeNS('', 'plain')).toBe('value');
    expect(element.hasAttributeNS(XML_NAMESPACE, 'lang')).toBe(true);
    expect(element.hasAttributeNS(null, 'lang')).toBe(false);
  });

  it('adds, changes, and removes attributes', () => {
    const element = new HTMLElement('main');

    element.setAttribute('DATA-STATE', 'first');
    expect(element.getAttribute('data-state')).toBe('first');

    element.setAttribute('data-state', 'second');
    expect(element.getAttribute('DATA-STATE')).toBe('second');

    element.removeAttribute('DATA-STATE');
    element.removeAttribute('missing');

    expect(element.getAttribute('data-state')).toBeNull();
  });
});

describe('Element interfaces', () => {
  it('creates HTML elements and specialized stylesheet elements', () => {
    const document = new Document();
    const main = document.createElement('MAIN');
    const style = document.createElement('STYLE');
    const link = document.createElement('LINK');

    expect(main).toBeInstanceOf(HTMLElement);
    expect(main.localName).toBe('main');
    expect(isHTMLElement(main)).toBe(true);

    expect(style).toBeInstanceOf(HTMLStyleElement);
    expect(isHTMLStyleElement(style)).toBe(true);

    expect(link).toBeInstanceOf(HTMLLinkElement);
    expect(isHTMLLinkElement(link)).toBe(true);
  });

  it('uses namespaces rather than local names to choose an interface', () => {
    const document = new Document();
    const htmlSvg = document.createElement('svg');
    const svg = document.createElement('svg', SVG_NAMESPACE);
    const svgStyle = document.createElement('style', SVG_NAMESPACE);
    const math = document.createElement('math', MATHML_NAMESPACE);
    const other = document.createElement('style', 'https://example.test/ns');

    expect(htmlSvg).toBeInstanceOf(HTMLElement);
    expect(htmlSvg.namespaceURI).toBe(HTML_NAMESPACE);

    expect(svg).toBeInstanceOf(SVGElement);
    expect(isSVGElement(svg)).toBe(true);

    expect(svgStyle).toBeInstanceOf(SVGStyleElement);
    expect(isSVGStyleElement(svgStyle)).toBe(true);

    expect(math).toBeInstanceOf(MathMLElement);
    expect(isMathMLElement(math)).toBe(true);

    expect(other.constructor).toBe(Element);
    expect(isHTMLStyleElement(other)).toBe(false);
  });
});
