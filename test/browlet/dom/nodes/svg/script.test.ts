import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../../src/browlet/browlet';
import { SVGScriptElementImpl } from '../../../../../src/browlet/dom/nodes/svg/script-element';
import { unwrap } from '../../../../support/browlet-binding';

describe('SVGScriptElement identity', () => {
  it('keeps SVG scripts distinct from HTML scripts through creation and cloning', async () => {
    const browser = new Browlet({ route: () => '' });

    expect(await browser.evaluate(() => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'script');
      const html = document.createElement('script');
      return [svg instanceof SVGScriptElement, svg instanceof SVGElement,
        svg instanceof HTMLScriptElement, svg.cloneNode(false) instanceof SVGScriptElement,
        html instanceof HTMLScriptElement, html instanceof SVGScriptElement,
        document.createElementNS('urn:other', 'script') instanceof SVGScriptElement];
    })).toEqual([true, true, false, true, true, false, false]);
    expect(unwrap(browser.window.document.createElementNS('http://www.w3.org/2000/svg', 'script')))
      .toBeInstanceOf(SVGScriptElementImpl);
  });
});
