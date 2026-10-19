import { assert, describe, expect, it } from 'vitest';

import { HTML_NAMESPACE, XML_NAMESPACE } from '../../../../../../src/infra/index';
import { HTMLElementImpl } from '../../../../../../src/browlet/dom/nodes/html/html-element';
import { createTestDocument, parseTestDocument } from '../../../../../support/dom';

describe('HTML global content-attribute permissions', () => {
  // https://html.spec.whatwg.org/multipage/dom.html#global-attributes
  it('permits every listed global on ordinary, unfinished, custom, and unknown HTML elements', () => {
    const document = createTestDocument();
    const names = [
      'accesskey', 'autocapitalize', 'autocorrect', 'autofocus', 'contenteditable', 'dir', 'draggable',
      'enterkeyhint', 'headingoffset', 'headingreset', 'hidden', 'inert', 'inputmode', 'is', 'itemid',
      'itemprop', 'itemref', 'itemscope', 'itemtype', 'lang', 'nonce', 'popover', 'spellcheck', 'style',
      'tabindex', 'title', 'translate', 'writingsuggestions', 'class', 'id', 'slot',
    ];
    for (const tag of ['article', 'input', 'x-widget', 'unknown']) {
      const element = document.createElementNS(HTML_NAMESPACE, tag);
      assert(element instanceof HTMLElementImpl);
      for (const name of names) expect(element.allowsContentAttribute(name), `${tag}: ${name}`).toBe(true);
      expect(element.hasAttributes()).toBe(false);
    }
  });

  it('permits every handler listed in the preamble, including body Window-target names', () => {
    const document = createTestDocument();
    const names = [
      'onauxclick', 'onbeforeinput', 'onbeforematch', 'onbeforetoggle', 'onblur', 'oncancel',
      'oncanplay', 'oncanplaythrough', 'onchange', 'onclick', 'onclose', 'oncommand', 'oncontextlost',
      'oncontextmenu', 'oncontextrestored', 'oncopy', 'oncuechange', 'oncut', 'ondblclick', 'ondrag',
      'ondragend', 'ondragenter', 'ondragleave', 'ondragover', 'ondragstart', 'ondrop', 'ondurationchange',
      'onemptied', 'onended', 'onerror', 'onfocus', 'onformdata', 'oninput', 'oninvalid', 'onkeydown',
      'onkeypress', 'onkeyup', 'onload', 'onloadeddata', 'onloadedmetadata', 'onloadstart', 'onmousedown',
      'onmouseenter', 'onmouseleave', 'onmousemove', 'onmouseout', 'onmouseover', 'onmouseup', 'onpaste',
      'onpause', 'onplay', 'onplaying', 'onprogress', 'onratechange', 'onreset', 'onresize', 'onscroll',
      'onscrollend', 'onsecuritypolicyviolation', 'onseeked', 'onseeking', 'onselect', 'onslotchange',
      'onstalled', 'onsubmit', 'onsuspend', 'ontimeupdate', 'ontoggle', 'onvolumechange', 'onwaiting', 'onwheel',
    ];
    for (const tag of ['article', 'body']) {
      const element = document.createElementNS(HTML_NAMESPACE, tag);
      assert(element instanceof HTMLElementImpl);
      for (const name of names) expect(element.allowsContentAttribute(name), `${tag}: ${name}`).toBe(true);
    }
  });

  // https://html.spec.whatwg.org/multipage/webappapis.html#handler-onabort
  it.each([
    'onabort', 'onwebkitanimationend', 'onwebkitanimationiteration',
    'onwebkitanimationstart', 'onwebkittransitionend',
  ])('permits the additional §8.1 global handler %s on every HTML element', (name) => {
    const document = createTestDocument();
    for (const tag of ['article', 'input', 'body', 'frameset', 'x-widget', 'unknown']) {
      const element = document.createElementNS(HTML_NAMESPACE, tag);
      assert(element instanceof HTMLElementImpl);
      expect(element.allowsContentAttribute(name), `${tag}: ${name}`).toBe(true);
    }
  });

  it('checks custom data names without restricting their values or requiring ASCII-only suffixes', () => {
    const element = createTestDocument().createElementNS(HTML_NAMESPACE, 'article');
    assert(element instanceof HTMLElementImpl);
    for (const name of ['data-value', 'data-1', 'data--', 'data-É', 'data-名称', 'data-x:y']) {
      expect(element.allowsContentAttribute(name), name).toBe(true);
      element.setAttribute(name, ' \r\n<arbitrary>\0');
      expect(element.getAttribute(name)).toBe(' \r\n<arbitrary>\0');
    }
    for (const name of ['data-', 'data-Value', 'data-valueA', 'data-a b', 'data-a\t', 'data-a/', 'data-a=', 'data-a>', 'data-a\0']) {
      expect(element.allowsContentAttribute(name), name).toBe(false);
    }
  });

  it('uses the current document type for the namespace-less xmlns compatibility name', () => {
    const xml = createTestDocument();
    const html = parseTestDocument('', xml.env);
    const element = xml.createElementNS(HTML_NAMESPACE, 'article');
    assert(element instanceof HTMLElementImpl);
    expect(element.allowsContentAttribute('xmlns')).toBe(false);
    html.adoptNode(element);
    expect(element.allowsContentAttribute('xmlns')).toBe(true);
    element.setAttribute('xmlns', 'urn:does-not-change-the-element');
    expect(element.namespaceURI).toBe(HTML_NAMESPACE);
    expect(element.allowsContentAttribute('xmlns')).toBe(true); // Name permission does not validate its value.
    xml.adoptNode(element);
    expect(element.allowsContentAttribute('xmlns')).toBe(false);
  });

  it('keeps ARIA and further handler inventories explicit', () => {
    const element = createTestDocument().createElementNS(HTML_NAMESPACE, 'article');
    assert(element instanceof HTMLElementImpl);
    for (const name of ['role', 'aria-label']) {
      expect(() => element.allowsContentAttribute(name)).toThrow('ARIA content-attribute permissions are not implemented');
    }
    for (const name of ['onpointerdown', 'onbeforeunload']) {
      expect(() => element.allowsContentAttribute(name)).toThrow(`Event-handler content-attribute permissions for ${name} are not implemented`);
    }
  });

  it('preserves XML whitespace attributes and text without treating a namespace-less lookalike as global', () => {
    const element = createTestDocument().createElementNS(HTML_NAMESPACE, 'article');
    assert(element instanceof HTMLElementImpl);
    element.textContent = '  text\n  ';
    element.setAttributeNS(XML_NAMESPACE, 'xml:space', 'default');
    expect(element.textContent).toBe('  text\n  ');
    expect(element.getAttributeNS(XML_NAMESPACE, 'space')).toBe('default');
    expect(element.getAttributeNS(null, 'xml:space')).toBe(null);
    expect(element.allowsContentAttribute('xml:space')).toBe(false);
  });
});
