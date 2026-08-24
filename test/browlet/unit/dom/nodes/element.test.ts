import { describe, expect, it } from 'vitest';

import { AttrImpl } from '../../../../../src/browlet/dom/nodes/attribute';
import { DocumentImpl } from '../../../../../src/browlet/dom/nodes/document';
import { ElementImpl } from '../../../../../src/browlet/dom/nodes/element';
import {
  HTML_NAMESPACE, XML_NAMESPACE,
} from '../../../../../src/shared/namespaces';

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
    const element = new ElementImpl(
      'main',
      HTML_NAMESPACE,
      new DocumentImpl(),
    );

    element.setAttribute('DATA-STATE', 'first');
    expect(element.getAttribute('data-state')).toBe('first');

    element.setAttribute('data-state', 'second');
    expect(element.getAttribute('DATA-STATE')).toBe('second');

    element.removeAttribute('DATA-STATE');
    element.removeAttribute('missing');

    expect(element.getAttribute('data-state')).toBeNull();
  });
});
