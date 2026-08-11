import { describe, expect, it } from 'vitest';

import { AttrImpl } from '../../../../src/domlet/nodes/attribute';
import { DocumentImpl } from '../../../../src/domlet/nodes/document';
import {
  ElementImpl, HTMLElementImpl, HTMLLinkElementImpl, HTMLStyleElementImpl,
  MathMLElementImpl, SVGElementImpl, SVGStyleElementImpl,
  HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE,
  isHTMLElement, isHTMLLinkElement, isHTMLStyleElement,
  isMathMLElement, isSVGElement, isSVGStyleElement,
} from '../../../../src/domlet/nodes/element';

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';

describe('Element attributes', () => {
  it('looks up unnamespaced attributes by qualified name', () => {
    const document = new DocumentImpl();
    const element = new ElementImpl('main', HTML_NAMESPACE, document, [
      new AttrImpl('id', 'content'),
      new AttrImpl('class', ''),
    ]);

    expect(element.getAttribute('id')).toBe('content');
    expect(element.getAttribute('missing')).toBeNull();
    expect(element.hasAttribute('class')).toBe(true);
    expect(element.hasAttribute('missing')).toBe(false);
  });

  it('looks up namespaced attributes by namespace and local name', () => {
    const document = new DocumentImpl();
    const element = new ElementImpl('main', HTML_NAMESPACE, document, [
      new AttrImpl('lang', 'en', XML_NAMESPACE, 'xml'),
      new AttrImpl('plain', 'value'),
    ]);

    expect(element.getAttribute('xml:lang')).toBe('en');
    expect(element.getAttributeNS(XML_NAMESPACE, 'lang')).toBe('en');
    expect(element.getAttributeNS(null, 'plain')).toBe('value');
    expect(element.getAttributeNS('', 'plain')).toBe('value');
    expect(element.hasAttributeNS(XML_NAMESPACE, 'lang')).toBe(true);
    expect(element.hasAttributeNS(null, 'lang')).toBe(false);
  });

  it('adds, changes, and removes attributes', () => {
    const element = new HTMLElementImpl('main', new DocumentImpl());

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
    const document = new DocumentImpl();
    const main = document.createElement('MAIN');
    const style = document.createElement('STYLE');
    const link = document.createElement('LINK');

    expect(main).toBeInstanceOf(HTMLElementImpl);
    expect(main.localName).toBe('main');
    expect(isHTMLElement(main)).toBe(true);

    expect(style).toBeInstanceOf(HTMLStyleElementImpl);
    expect(isHTMLStyleElement(style)).toBe(true);

    expect(link).toBeInstanceOf(HTMLLinkElementImpl);
    expect(isHTMLLinkElement(link)).toBe(true);
  });

  it('uses namespaces rather than local names to choose an interface', () => {
    const document = new DocumentImpl();
    const htmlSvg = document.createElement('svg');
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    const svgStyle = document.createElementNS(SVG_NAMESPACE, 'style');
    const math = document.createElementNS(MATHML_NAMESPACE, 'math');
    const other = document.createElementNS(
      'https://example.test/ns',
      'style',
    );

    expect(htmlSvg).toBeInstanceOf(HTMLElementImpl);
    expect(htmlSvg.namespaceURI).toBe(HTML_NAMESPACE);

    expect(svg).toBeInstanceOf(SVGElementImpl);
    expect(isSVGElement(svg)).toBe(true);

    expect(svgStyle).toBeInstanceOf(SVGStyleElementImpl);
    expect(isSVGStyleElement(svgStyle)).toBe(true);

    expect(math).toBeInstanceOf(MathMLElementImpl);
    expect(isMathMLElement(math)).toBe(true);

    expect(other.constructor).toBe(ElementImpl);
    expect(isHTMLStyleElement(other)).toBe(false);
  });
});
