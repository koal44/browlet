import { assert, describe, expect, it } from 'vitest';

import { HTMLElementImpl } from '../../../../../src/browlet/dom/nodes/html/html-element';
import { HTML_NAMESPACE } from '../../../../../src/infra/index';
import { createTestDocument } from '../../../../support/dom';

describe('HTML content-attribute permissions', () => {
  // https://html.spec.whatwg.org/multipage/grouping-content.html#the-blockquote-element
  // https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-q-element
  it.each(['q', 'blockquote'])('allows cite on %s regardless of whether it is already present', (name) => {
    const document = createTestDocument();
    const element = document.createElementNS(HTML_NAMESPACE, name);
    const other = document.createElementNS(HTML_NAMESPACE, name);
    assert(element instanceof HTMLElementImpl);
    assert(other instanceof HTMLElementImpl);
    expect(element.contentAttributes).toBe(other.contentAttributes);
    expect(Object.hasOwn(element, 'contentAttributes')).toBe(false);
    expect(Object.hasOwn(other, 'contentAttributes')).toBe(false);
    expect(element.hasAttribute('cite')).toBe(false);
    expect(element.allowsContentAttribute('cite')).toBe(true);
    element.setAttribute('cite', '/source');
    expect(element.allowsContentAttribute('cite')).toBe(true);
    element.removeAttribute('cite');
    expect(element.allowsContentAttribute('cite')).toBe(true);
  });

  // https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-a-element
  it.each(['target', 'download', 'ping', 'rel', 'hreflang', 'type', 'referrerpolicy'])(
    'allows anchor %s only while that instance has href', (name) => {
      const document = createTestDocument();
      const anchor = document.createElementNS(HTML_NAMESPACE, 'a');
      const other = document.createElementNS(HTML_NAMESPACE, 'a');
      assert(anchor instanceof HTMLElementImpl);
      assert(other instanceof HTMLElementImpl);
      expect(anchor.allowsContentAttribute('href')).toBe(true);
      expect(anchor.allowsContentAttribute(name)).toBe(false);
      anchor.setAttributeNS('urn:other', 'x:href', '/target');
      expect(anchor.allowsContentAttribute(name)).toBe(false);
      anchor.setAttribute('href', '');
      expect(anchor.allowsContentAttribute(name)).toBe(true);
      expect(other.allowsContentAttribute(name)).toBe(false);
      anchor.removeAttribute('href');
      expect(anchor.allowsContentAttribute(name)).toBe(false);
      expect(anchor.allowsContentAttribute('href')).toBe(true);
    },
  );

  it('does not enforce conformance during DOM mutation or change stored attributes', () => {
    const anchor = createTestDocument().createElementNS(HTML_NAMESPACE, 'a');
    assert(anchor instanceof HTMLElementImpl);
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('unrecognized', 'retained');
    expect(anchor.allowsContentAttribute('target')).toBe(false);
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('unrecognized')).toBe('retained');
  });

  it('distinguishes a completed element inventory from unfinished global rules', () => {
    const document = createTestDocument();
    for (const tag of ['article', 'div', 'q', 'blockquote', 'a']) {
      const element = document.createElementNS(HTML_NAMESPACE, tag);
      assert(element instanceof HTMLElementImpl);
      for (const name of ['id', 'data-example', 'aria-label', 'onclick', 'unrecognized']) {
        expect(() => element.allowsContentAttribute(name))
          .toThrow(`Global content-attribute rules for ${name} are not implemented`);
      }
    }
  });

  it('leaves unrecorded elements explicit even if an attribute is present', () => {
    const input = createTestDocument().createElementNS(HTML_NAMESPACE, 'input');
    assert(input instanceof HTMLElementImpl);
    input.setAttribute('name', 'example');
    expect(() => input.allowsContentAttribute('name')).toThrow('Content attributes for input are not implemented');
  });
});
