import { describe, expect, it } from 'vitest';

import { Attribute } from '../../../../src/domlet/nodes/attribute';
import { Element } from '../../../../src/domlet/nodes/element';

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
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
});
