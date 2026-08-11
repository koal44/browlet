import { describe, expect, it } from 'vitest';

import { createDomlet } from '../../../src/domlet/domlet';
import type { DocumentImpl } from '../../../src/domlet/nodes/document';
import {
  isHTMLStyleElement, type HTMLStyleElementImpl,
} from '../../../src/domlet/nodes/element';

describe('stylesheet integration', () => {
  it('creates and associates parser-created inline style sheets', () => {
    const document = createDomlet({
      source: '<style id="style">main { color: green }</style>',
    });
    const style = getStyleElement(document, 'style');
    const sheet = style.sheet;

    expect(sheet).toBeDefined();
    expect(sheet).not.toBeNull();
    expect(sheet?.ownerNode).toBe(style);
    expect(sheet?.cssRules).toHaveLength(1);
  });

  it('exposes inline style sheets in tree order', () => {
    const document = createDomlet({
      source: [
        '<style id="first">main { color: green }</style>',
        '<style id="second">aside { color: blue }</style>',
      ].join(''),
    });
    const first = getStyleElement(document, 'first');
    const second = getStyleElement(document, 'second');
    const styleSheets = document.styleSheets;

    expect(document.styleSheets).toBe(styleSheets);
    expect(styleSheets).toHaveLength(2);
    expect(styleSheets.item(0)).toBe(first.sheet);
    expect(styleSheets.item(1)).toBe(second.sheet);
  });

  it('maintains tree order across insertion and movement', () => {
    const document = createDomlet({
      source: '<style id="second">aside { color: blue }</style>',
    });
    const second = getStyleElement(document, 'second');
    const first = document.createElement('style');
    if (!isHTMLStyleElement(first)) {
      throw new Error('Expected an HTML style element');
    }
    first.appendChild(document.createTextNode('main { color: green }'));

    second.parentNode!.insertBefore(first, second);

    expect(document.styleSheets.item(0)).toBe(first.sheet);
    expect(document.styleSheets.item(1)).toBe(second.sheet);

    first.parentNode!.insertBefore(second, first);

    expect(document.styleSheets.item(0)).toBe(second.sheet);
    expect(document.styleSheets.item(1)).toBe(first.sheet);
  });

  it('updates both sides of the association across insertion and removal', () => {
    const document = createDomlet();
    const style = document.createElement('style');
    if (!isHTMLStyleElement(style)) {
      throw new Error('Expected an HTML style element');
    }
    style.appendChild(document.createTextNode('main { color: green }'));

    expect(style.sheet).toBeNull();

    document.appendChild(style);
    const sheet = style.sheet;

    expect(sheet).not.toBeNull();
    expect(sheet?.ownerNode).toBe(style);
    expect(document.styleSheets.item(0)).toBe(sheet);

    style.remove();

    expect(style.sheet).toBeNull();
    expect(sheet?.ownerNode).toBeNull();
    expect(document.styleSheets).toHaveLength(0);
  });

  it('replaces an associated sheet when its text changes', () => {
    const document = createDomlet({
      source: '<style id="style">main { color: green }</style>',
    });
    const style = getStyleElement(document, 'style');
    const firstSheet = style.sheet;
    const text = style.firstChild;

    if (!text || !('data' in text)) {
      throw new Error('Expected style text');
    }

    text.data = 'aside { color: blue }';

    expect(style.sheet).not.toBe(firstSheet);
    expect(firstSheet?.ownerNode).toBeNull();
    expect(style.sheet?.ownerNode).toBe(style);
    expect(style.sheet?.cssRules).toHaveLength(1);
    expect(document.styleSheets.item(0)).toBe(style.sheet);
  });
});

function getStyleElement(
  document: DocumentImpl,
  id: string,
): HTMLStyleElementImpl {
  const element = document.getElementById(id);
  if (!element || !isHTMLStyleElement(element)) {
    throw new Error(`Missing HTML style element: ${id}`);
  }
  return element;
}
