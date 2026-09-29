import { describe, expect, it } from 'vitest';

import { parseTestDocument } from '../../support/dom';
import { HTMLElementImpl } from '../../../src/browlet/html/elements/html-element';
import { SVGElementImpl } from '../../../src/browlet/svg/element';
import { MathMLElementImpl } from '../../../src/browlet/mathml/element';
import {
  MATHML_NAMESPACE, SVG_NAMESPACE,
} from '../../../src/infra/index';

describe('ElementCSSInlineStyle', () => {
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

    html.style.setProperty('opacity', '0.1');
    svg.style.setProperty('opacity', '0.2');
    math.style.setProperty('opacity', '0.3');

    expect(html.getAttribute('style')).toBe('opacity: 0.1;');
    expect(svg.getAttribute('style')).toBe('opacity: 0.2;');
    expect(math.getAttribute('style')).toBe('opacity: 0.3;');
  });
});

function createTestDocument(config: { source?: string; } = {}) {
  return parseTestDocument(config.source);
}
