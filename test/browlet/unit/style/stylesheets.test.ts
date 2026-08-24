import { describe, expect, it, vi } from 'vitest';

import {
  isHTMLElement,
} from '../../../../src/browlet/html/elements/html-element';
import {
  isHTMLStyleElement, type HTMLStyleElementImpl,
} from '../../../../src/browlet/html/elements/metadata/style';
import {
  isSVGStyleElement,
} from '../../../../src/browlet/svg/style-element';
import {
  parseHTMLDocument,
} from '../../../../src/browlet/html/parser/parse';
import { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';

describe('stylesheet integration', () => {
  it('creates and associates parser-created inline style sheets', () => {
    const document = createTestDocument({
      source: '<style id="style">main { color: green }</style>',
    });
    const style = getStyleElement(document, 'style');
    const sheet = style.sheet;

    expect(sheet).toBeDefined();
    expect(sheet).not.toBeNull();
    expect(sheet?.ownerNode).toBe(style);
    expect(sheet?.cssRules).toHaveLength(1);
  });

  it('associates SVG style elements with the document tree scope', () => {
    const document = createTestDocument({
      source: [
        '<svg><style id="style">circle { opacity: 0.5 }</style></svg>',
      ].join(''),
    });
    const style = document.getElementById('style');
    if (!style || !isSVGStyleElement(style)) {
      throw new Error('Expected an SVG style element');
    }

    expect(style.sheet).not.toBeNull();
    expect(style.sheet?.ownerNode).toBe(style);
    expect(document.styleSheets.item(0)).toBe(style.sheet);
  });

  it('keeps media and title synchronized without replacing the sheet', () => {
    const document = createTestDocument({
      source: '<style id="style">main { opacity: 0.5 }</style>',
    });
    const style = getStyleElement(document, 'style');
    const sheet = style.sheet;

    style.setAttribute('media', 'screen');
    style.setAttribute('title', 'theme');

    expect(style.sheet).toBe(sheet);
    expect(sheet?.media.mediaText).toBe('screen');
    expect(sheet?.title).toBe('theme');

    style.removeAttribute('media');
    style.removeAttribute('title');

    expect(style.sheet).toBe(sheet);
    expect(sheet?.media.mediaText).toBe('');
    expect(sheet?.title).toBeNull();
  });

  it('removes and recreates an association when its type changes', () => {
    const document = createTestDocument({
      source: '<style id="style">main { opacity: 0.5 }</style>',
    });
    const style = getStyleElement(document, 'style');
    const sheet = style.sheet;

    style.setAttribute('type', 'text/example');

    expect(style.sheet).toBeNull();
    expect(sheet?.ownerNode).toBeNull();
    expect(document.styleSheets).toHaveLength(0);

    style.setAttribute('type', 'TEXT/CSS');

    expect(style.sheet).not.toBeNull();
    expect(style.sheet).not.toBe(sheet);
    expect(style.sheet?.ownerNode).toBe(style);
    expect(document.styleSheets.item(0)).toBe(style.sheet);
  });

  it('exposes inline style sheets in tree order', () => {
    const document = createTestDocument({
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
    const document = createTestDocument({
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
    const document = createTestDocument();
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
    const document = createTestDocument({
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

  it('cascades matched sheets with inline declarations and resolves values', () => {
    const document = createTestDocument({
      source: [
        '<style id="style">',
        '.other { opacity: 0.1 }',
        '.target { opacity: 2 !important }',
        '</style>',
        '<main id="target" class="target" style="opacity: 0.75"></main>',
      ].join(''),
    });
    const style = getStyleElement(document, 'style');
    const target = document.getElementById('target')!;
    const engine = DocumentImpl.getCSSEngine(document);
    const computed = engine.getComputedStyle(target);

    expect(computed.opacity).toBe('1');
    expect(computed.cssText).toBe('');
    expect(() => computed.setProperty('opacity', '0.5'))
      .toThrow(expect.objectContaining({
        name: 'NoModificationAllowedError',
      }));

    const rule = style.sheet?.cssRules.item(1) as CSSStyleRule;
    rule.style.setProperty('opacity', '0.25', 'important');

    expect(engine.getComputedStyle(target).opacity).toBe('0.25');

    style.remove();

    expect(engine.getComputedStyle(target).opacity).toBe('0.75');
  });

  it('computes from the synchronized inline declaration state', () => {
    const document = createTestDocument({
      source: '<main id="target" style="opacity: 0.5"></main>',
    });
    const target = document.getElementById('target');
    if (!target || !isHTMLElement(target)) {
      throw new Error('Missing HTML target element');
    }
    void target.style;
    const getAttribute = vi.spyOn(target, 'getAttribute');

    expect(DocumentImpl.getCSSEngine(document).getComputedStyle(target).opacity)
      .toBe('0.5');
    expect(getAttribute).not.toHaveBeenCalledWith('style');
  });

  it('keeps cascade order synchronized with document order', () => {
    const document = createTestDocument({
      source: [
        '<style id="first">.target { opacity: 0.1 }</style>',
        '<style id="second">.target { opacity: 0.2 }</style>',
        '<main id="target" class="target"></main>',
      ].join(''),
    });
    const first = getStyleElement(document, 'first');
    const second = getStyleElement(document, 'second');
    const target = document.getElementById('target')!;
    const engine = DocumentImpl.getCSSEngine(document);

    expect(engine.getComputedStyle(target).opacity).toBe('0.2');

    first.parentNode!.insertBefore(second, first);

    expect(engine.getComputedStyle(target).opacity).toBe('0.1');
  });

  it('enables the first titled stylesheet set', () => {
    const document = createTestDocument({
      source: [
        '<style title="alpha">.target { opacity: 0.25 }</style>',
        '<style title="beta">.target { opacity: 0.5 }</style>',
        '<main id="target" class="target"></main>',
      ].join(''),
    });
    const target = document.getElementById('target')!;
    const alpha = document.styleSheets.item(0)!;
    const beta = document.styleSheets.item(1)!;

    expect(alpha.disabled).toBe(false);
    expect(beta.disabled).toBe(true);
    expect(DocumentImpl.getCSSEngine(document).getComputedStyle(target).opacity)
      .toBe('0.25');
  });

  it('exposes observable adopted stylesheets without replacing the array', () => {
    const document = createTestDocument({
      source: '<main id="target" class="target"></main>',
    });
    const target = document.getElementById('target')!;
    const styleSheets = document.adoptedStyleSheets;
    const first = DocumentImpl.getCSSEngine(document).createStyleSheet();
    const second = DocumentImpl.getCSSEngine(document).createStyleSheet();
    first.replaceSync('.target { opacity: 0.25 }');
    second.replaceSync('.target { opacity: 0.5 }');

    document.adoptedStyleSheets = [first];

    expect(document.adoptedStyleSheets).toBe(styleSheets);
    expect(styleSheets).toEqual([first]);
    expect(DocumentImpl.getCSSEngine(document).getComputedStyle(target).opacity)
      .toBe('0.25');

    styleSheets.push(second);

    expect(DocumentImpl.getCSSEngine(document).getComputedStyle(target).opacity)
      .toBe('0.5');

    styleSheets.reverse();

    expect(DocumentImpl.getCSSEngine(document).getComputedStyle(target).opacity)
      .toBe('0.25');

    styleSheets.splice(1, 1);

    expect(DocumentImpl.getCSSEngine(document).getComputedStyle(target).opacity)
      .toBe('0.5');

    styleSheets.splice(0, 1, first);

    expect(DocumentImpl.getCSSEngine(document).getComputedStyle(target).opacity)
      .toBe('0.25');
  });

  it('only adopts constructed stylesheets from the same document', () => {
    const document = createTestDocument({
      source: '<style id="style">main { opacity: 0.5 }</style>',
    });
    const embedded = getStyleElement(document, 'style').sheet!;
    const otherDocument = createTestDocument();
    const foreign = DocumentImpl.getCSSEngine(otherDocument).createStyleSheet();

    expect(() => document.adoptedStyleSheets.push(embedded))
      .toThrow(expect.objectContaining({ name: 'NotAllowedError' }));
    expect(() => document.adoptedStyleSheets.push(foreign))
      .toThrow(expect.objectContaining({ name: 'NotAllowedError' }));
    expect(() => document.adoptedStyleSheets.push(
      'not a stylesheet' as unknown as CSSStyleSheet,
    )).toThrow(TypeError);
    expect(document.adoptedStyleSheets).toHaveLength(0);
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

function createTestDocument(
  config: { source?: string; } = {},
): DocumentImpl {
  return parseHTMLDocument(config.source);
}
