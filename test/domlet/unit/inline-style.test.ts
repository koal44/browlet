import { describe, expect, it } from 'vitest';

import { Domlet } from '../../../src/domlet/domlet';
import {
  isHTMLElement, MATHML_NAMESPACE, SVG_NAMESPACE,
} from '../../../src/domlet/nodes/element';

describe('ElementCSSInlineStyle', () => {
  it('exposes a same-object declaration block initialized from the attribute', () => {
    const document = createDomlet({
      source: '<main id="target" style="opacity: 50%; color: red"></main>',
    });
    const target = document.getElementById('target');
    if (!target || !isHTMLElement(target)) {
      throw new Error('Missing HTML target element');
    }

    expect(target.style).toBe(target.style);
    expect(target.style.opacity).toBe('0.5');
    expect(target.style.color).toBe('red');
    expect([...target.style]).toEqual(['opacity', 'color']);
  });

  it('synchronizes declaration and attribute mutations without recursion', () => {
    const document = createDomlet();
    const target = document.createElement('main');
    const style = target.style;

    Reflect.set(style, 'opacity', 0.75);

    expect(style.opacity).toBe('0.75');
    expect(target.getAttribute('style')).toBe('opacity: 0.75;');

    target.setAttribute('style', 'opacity: 1; color: blue');

    expect(target.style).toBe(style);
    expect(style.opacity).toBe('1');
    expect(style.color).toBe('blue');

    Reflect.set(style, 'opacity', null);

    expect(style.opacity).toBe('');
    expect(target.getAttribute('style')).toBe('color: blue;');
  });

  it('is shared by the HTML, SVG, and MathML element interfaces', () => {
    const document = createDomlet();
    const html = document.createElement('main');
    const svg = document.createElementNS(SVG_NAMESPACE, 'circle');
    const math = document.createElementNS(MATHML_NAMESPACE, 'math');

    html.style.setProperty('opacity', '0.1');
    svg.style.setProperty('opacity', '0.2');
    math.style.setProperty('opacity', '0.3');

    expect(html.getAttribute('style')).toBe('opacity: 0.1;');
    expect(svg.getAttribute('style')).toBe('opacity: 0.2;');
    expect(math.getAttribute('style')).toBe('opacity: 0.3;');
  });
});

function createDomlet(config: { source?: string; } = {}) {
  return new Domlet().parse(config.source);
}
