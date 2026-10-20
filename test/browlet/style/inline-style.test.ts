import { assert, describe, expect, it, vi } from 'vitest';

import { parseTestDocument } from '../../support/dom';
import { HTMLElementImpl } from '../../../src/browlet/dom/nodes/html/html-element';
import { SVGElementImpl } from '../../../src/browlet/dom/nodes/svg/element';
import { MathMLElementImpl } from '../../../src/browlet/dom/nodes/mathml/element';
import { ElementCSSInlineStyleMixin } from '../../../src/browlet/style/integration';
import {
  HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE,
} from '../../../src/infra/index';

describe('ElementCSSInlineStyle', () => {
  it.each([HTML_NAMESPACE, SVG_NAMESPACE, MATHML_NAMESPACE])(
    'parses and computes inline declarations before creating CSSOM for %s', (namespace) => {
      const document = createTestDocument();
      const target = document.createElementNS(namespace, 'a');
      if (!HTMLElementImpl.is(target) && !SVGElementImpl.is(target) && !MathMLElementImpl.is(target)) {
        throw new Error('Expected an HTML, SVG, or MathML element');
      }
      const getStyle = vi.spyOn(ElementCSSInlineStyleMixin.prototype, 'style', 'get');
      try {
        target.setAttribute('style', 'opacity: .2; opacity: .4 !important; opacity: .8');
        const block = target.getInlineStyleBlock();
        assert.isNotNull(block);
        expect(document.getCSSEngine().getComputedStyle(target).getPropertyValue('opacity')).toBe('0.4');
        expect(getStyle).not.toHaveBeenCalled();

        const style = target.style;
        expect(target.getInlineStyleBlock()).toBe(block);
        expect(style.getPropertyValue('opacity')).toBe('0.4');
        expect(style.item(0)).toBe('opacity');

        target.setAttribute('style', 'color: red; opacity: .6');
        expect(target.getInlineStyleBlock()).toBe(block);
        expect(getStyle).toHaveBeenCalledOnce();
        expect(style.item(0)).toBe('color');
        expect(style.item(1)).toBe('opacity');
        expect(document.getCSSEngine().getComputedStyle(target).getPropertyValue('opacity')).toBe('0.6');

        target.removeAttribute('style');
        expect(style.length).toBe(0);
        expect(Object.hasOwn(style, 0)).toBe(false);
        expect(Object.hasOwn(style, 1)).toBe(false);

        style.setProperty('opacity', '.7');
        expect(block.cssText).toBe('opacity: 0.7;');
        expect(target.getAttribute('style')).toBe('opacity: 0.7;');
        expect(document.getCSSEngine().getComputedStyle(target).getPropertyValue('opacity')).toBe('0.7');
        expect(target.style).toBe(style);
      } finally { getStyle.mockRestore(); }
    },
  );

  it('recovers after an unmatched brace and ignores at-rules in attribute declarations', () => {
    const document = createTestDocument();
    const target = document.createElement('main');
    const source = 'opacity: .2; } color: red; @media all { opacity: .9 } opacity: .7; color: blue !important; color: red';
    target.setAttribute('style', source);

    const block = target.getInlineStyleBlock();
    assert.isNotNull(block);
    expect(block.cssText).toBe('opacity: 0.7; color: blue !important;');
    expect(target.getAttribute('style')).toBe(source);
  });

  it.each(['&', 'bad'])('does not parse %s { ... } as a nested style rule inside an attribute', (selector) => {
    const document = createTestDocument();
    const target = document.createElement('main');
    target.setAttribute('style', `color: red; ${selector} { color: green } opacity: .5`);
    const block = target.getInlineStyleBlock();
    assert.isNotNull(block);
    expect(block.cssText).toBe('color: red;');
  });

  it('exposes a same-object declaration block initialized from the attribute', () => {
    const document = createTestDocument({
      source: '<main id="target" style="opacity: 50%; color: red"></main>',
    });
    const target = document.getElementById('target');
    if (!HTMLElementImpl.is(target)) {
      throw new Error('Missing HTML target element');
    }

    expect(target.style).toBe(target.style);
    expect(target.style.getPropertyValue('opacity')).toBe('0.5');
    expect(target.style.getPropertyValue('color')).toBe('red');
    expect([...target.style]).toEqual(['opacity', 'color']);
  });

  it('synchronizes declaration and attribute mutations without recursion', () => {
    const document = createTestDocument();
    const target = document.createElement('main');
    if (!HTMLElementImpl.is(target)) {
      throw new Error('Expected an HTML element');
    }
    const style = target.style;

    style.setProperty('opacity', '0.75');

    expect(style.getPropertyValue('opacity')).toBe('0.75');
    expect(target.getAttribute('style')).toBe('opacity: 0.75;');

    target.setAttribute('style', 'opacity: 1; color: blue');

    expect(target.style).toBe(style);
    expect(style.getPropertyValue('opacity')).toBe('1');
    expect(style.getPropertyValue('color')).toBe('blue');

    style.removeProperty('opacity');

    expect(style.getPropertyValue('opacity')).toBe('');
    expect(target.getAttribute('style')).toBe('color: blue;');
  });

  it('is shared by the HTML, SVG, and MathML element interfaces', () => {
    const document = createTestDocument();
    const html = document.createElement('main');
    const svg = document.createElementNS(SVG_NAMESPACE, 'circle');
    const math = document.createElementNS(MATHML_NAMESPACE, 'math');
    if (!HTMLElementImpl.is(html) || !SVGElementImpl.is(svg) || !MathMLElementImpl.is(math)) {
      throw new Error('Expected HTML, SVG, and MathML element implementations');
    }

    const dom = document.env.userAgent.dom;
    for (const element of [html, svg, math]) {
      expect(element.getInlineStyleBlock()).toBeNull();
      expect(dom.inlineStyleBlock?.(element)).toBeNull();
      document.getCSSEngine().getComputedStyle(element);
      expect(element.getInlineStyleBlock()).toBeNull();
    }

    html.style.setProperty('opacity', '0.1');
    svg.style.setProperty('opacity', '0.2');
    math.style.setProperty('opacity', '0.3');

    expect(html.getAttribute('style')).toBe('opacity: 0.1;');
    expect(svg.getAttribute('style')).toBe('opacity: 0.2;');
    expect(math.getAttribute('style')).toBe('opacity: 0.3;');

    for (const element of [html, svg, math]) {
      expect(dom.inlineStyleBlock?.(element)).toBe(element.getInlineStyleBlock());
      expect(element.getInlineStyleBlock()?.cssText).toBe(element.style.cssText);
    }
  });

  it('has no inline declaration for elements outside the three CSSOM includers', () => {
    const document = createTestDocument();
    const element = document.createElementNS('urn:example', 'other');
    element.setAttribute('style', 'opacity: .5');

    expect(element.getInlineStyleBlock()).toBeNull();
    expect(document.env.userAgent.dom.inlineStyleBlock?.(element)).toBeNull();
    expect(element.getAttribute('style')).toBe('opacity: .5');
  });
});

function createTestDocument(config: { source?: string; } = {}) {
  return parseTestDocument(config.source);
}
