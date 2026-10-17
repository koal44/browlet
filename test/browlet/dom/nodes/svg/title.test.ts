import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../../src/browlet/browlet';

describe('SVGTitleElement', () => {
  it('keeps SVG titles distinct from HTML titles through creation and cloning', async () => {
    const browser = new Browlet({ route: () => '' });

    expect(await browser.evaluate(() => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      const html = document.createElement('title');
      return [svg instanceof SVGTitleElement, svg instanceof SVGElement,
        svg instanceof HTMLTitleElement, svg.cloneNode(true) instanceof SVGTitleElement,
        html instanceof HTMLTitleElement, html instanceof SVGTitleElement,
        document.createElementNS('urn:other', 'title') instanceof SVGTitleElement];
    })).toEqual([true, true, false, true, true, false, false]);
  });
});
