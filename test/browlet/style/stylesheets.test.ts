import { describe, expect, it, vi } from 'vitest';

import { HTMLElementImpl } from '../../../src/browlet/html/elements/html-element';
import { HTMLStyleElementImpl } from '../../../src/browlet/html/elements/metadata/style';
import { SVGStyleElementImpl } from '../../../src/browlet/svg/style-element';
import { CSSStyleRuleImpl } from '../../../src/stylelet/cssom/rules';
import { parseTestDocument } from '../../support/dom';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';

describe('stylesheet integration', () => {
  it('uses the owner DOM provider for detached inline styles without creating a style engine', () => {
    const document = createTestDocument();
    const element = document.createElement('div');
    const getCSSEngine = vi.spyOn(document, 'getCSSEngine');
    const { userAgent } = document.env;
    const setAttribute = vi.fn(userAgent.dom.setAttribute.bind(userAgent.dom));
    userAgent.dom = { ...userAgent.dom, setAttribute };

    element.getInlineStyle().setProperty('opacity', '0.25');

    expect(element.nodeDocument).toBe(document);
    expect(element.parentNode).toBeNull();
    expect(element.getAttribute('style')).toBe('opacity: 0.25;');
    expect(setAttribute).toHaveBeenCalledWith(element, 'style', 'opacity: 0.25;');
    expect(getCSSEngine).not.toHaveBeenCalled();
  });

  it('replaces sheets through the existing environment and its owner task queue', async () => {
    const document = createTestDocument();
    const { env } = document;
    const background = vi.spyOn(env.exec, 'runInParallel');
    const delivery = vi.spyOn(env.exec.style, 'queueTask');
    const styles = document.getCSSEngine();
    const sheet = styles.createStyleSheet();

    expect(styles.context.env).toBe(env);
    expect(styles.context.dom).toBe(env.userAgent.dom);
    const replacement = sheet.replace('main { opacity: 0.25 }');
    expect(sheet.cssRules).toHaveLength(0);
    const completed = await new Promise((resolve, reject) => { replacement.observe(resolve, reject); });

    expect(completed).toBe(sheet);
    expect(sheet.cssRules).toHaveLength(1);
    expect(background).toHaveBeenCalledOnce();
    expect(delivery).toHaveBeenCalledOnce();
  });

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
    if (!SVGStyleElementImpl.is(style)) {
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
    if (!HTMLStyleElementImpl.is(first)) {
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
    if (!HTMLStyleElementImpl.is(style)) {
      throw new Error('Expected an HTML style element');
    }
    style.appendChild(document.createTextNode('main { color: green }'));

    expect(style.sheet).toBeNull();

    document.head!.appendChild(style);
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

    if (!text?.isText()) {
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
    const engine = document.getCSSEngine();
    const computed = engine.getComputedStyle(target);

    expect(computed.getPropertyValue('opacity')).toBe('1');
    expect(computed.cssText).toBe('');
    expect(() => computed.setProperty('opacity', '0.5'))
      .toThrow(expect.objectContaining({
        name: 'NoModificationAllowedError',
      }));

    const rule = style.sheet?.cssRules.item(1);
    if (!(rule instanceof CSSStyleRuleImpl)) {
      throw new Error('Expected a style rule implementation');
    }
    rule.style.setProperty('opacity', '0.25', 'important');

    expect(engine.getComputedStyle(target).getPropertyValue('opacity')).toBe('0.25');

    style.remove();

    expect(engine.getComputedStyle(target).getPropertyValue('opacity')).toBe('0.75');
  });

  it('computes from the synchronized inline declaration state', () => {
    const document = createTestDocument({
      source: '<main id="target" style="opacity: 0.5"></main>',
    });
    const target = document.getElementById('target');
    if (!HTMLElementImpl.is(target)) {
      throw new Error('Missing HTML target element');
    }
    void target.style;
    const getAttribute = vi.spyOn(target, 'getAttribute');

    expect(document.getCSSEngine().getComputedStyle(target).getPropertyValue('opacity'))
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
    const engine = document.getCSSEngine();

    expect(engine.getComputedStyle(target).getPropertyValue('opacity')).toBe('0.2');

    first.parentNode!.insertBefore(second, first);

    expect(engine.getComputedStyle(target).getPropertyValue('opacity')).toBe('0.1');
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
    expect(document.getCSSEngine().getComputedStyle(target).getPropertyValue('opacity'))
      .toBe('0.25');
  });

  it('exposes observable adopted stylesheets without replacing the array', () => {
    const document = createTestDocument({
      source: '<main id="target" class="target"></main>',
    });
    const target = document.getElementById('target')!;
    const styleSheets = document.adoptedStyleSheets;
    const first = document.getCSSEngine().createStyleSheet();
    const second = document.getCSSEngine().createStyleSheet();
    first.replaceSync('.target { opacity: 0.25 }');
    second.replaceSync('.target { opacity: 0.5 }');

    document.adoptedStyleSheets = [first];

    expect(document.adoptedStyleSheets).toBe(styleSheets);
    expect(styleSheets).toEqual([first]);
    expect(document.getCSSEngine().getComputedStyle(target).getPropertyValue('opacity'))
      .toBe('0.25');

    styleSheets.push(second);

    expect(document.getCSSEngine().getComputedStyle(target).getPropertyValue('opacity'))
      .toBe('0.5');

    styleSheets.reverse();

    expect(document.getCSSEngine().getComputedStyle(target).getPropertyValue('opacity'))
      .toBe('0.25');

    styleSheets.splice(1, 1);

    expect(document.getCSSEngine().getComputedStyle(target).getPropertyValue('opacity'))
      .toBe('0.5');

    styleSheets.splice(0, 1, first);

    expect(document.getCSSEngine().getComputedStyle(target).getPropertyValue('opacity'))
      .toBe('0.25');
  });

  it('only adopts constructed stylesheets from the same document', () => {
    const document = createTestDocument({
      source: '<style id="style">main { opacity: 0.5 }</style>',
    });
    const embedded = getStyleElement(document, 'style').sheet!;
    const otherDocument = createTestDocument();
    const foreign = otherDocument.getCSSEngine().createStyleSheet();

    expect(() => document.adoptedStyleSheets.push(embedded))
      .toThrow(expect.objectContaining({ name: 'NotAllowedError' }));
    expect(() => document.adoptedStyleSheets.push(foreign))
      .toThrow(expect.objectContaining({ name: 'NotAllowedError' }));
    expect(() => document.adoptedStyleSheets.push(
      'not a stylesheet' as never,
    )).toThrow(TypeError);
    expect(document.adoptedStyleSheets).toHaveLength(0);
  });
});

function getStyleElement(
  document: DocumentImpl,
  id: string,
): HTMLStyleElementImpl {
  const element = document.getElementById(id);
  if (!HTMLStyleElementImpl.is(element)) {
    throw new Error(`Missing HTML style element: ${id}`);
  }
  return element;
}

function createTestDocument(
  config: { source?: string; } = {},
): DocumentImpl {
  return parseTestDocument(config.source);
}
