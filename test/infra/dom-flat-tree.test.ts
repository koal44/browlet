import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { standardDOM } from '../../src/infra/dom-standard';

describe('flat-tree parent through the standard DOM adapter', () => {
  it('follows ordinary parents and crosses from a shadow child to its host', () => {
    const { window } = new JSDOM('<main><span></span></main>');
    try {
      const host = window.document.querySelector('main')!;
      const lightChild = host.firstChild!;
      expect(standardDOM.flatTreeParent(lightChild)).toBe(host);
      expect(standardDOM.flatTreeParent(window.document)).toBeNull();
      const shadow = host.attachShadow({ mode: 'open' });
      const shadowChild = window.document.createElement('div');
      shadow.append(shadowChild);
      expect(standardDOM.flatTreeParent(shadowChild)).toBe(host);
      expect(standardDOM.flatTreeParent(lightChild)).toBeNull();
    } finally { window.close(); }
  });

  it('uses assigned slots and excludes their replaced fallback children', () => {
    const { window } = new JSDOM('<main><span></span>text</main>');
    try {
      const host = window.document.querySelector('main')!;
      const shadow = host.attachShadow({ mode: 'open' });
      const slot = window.document.createElement('slot');
      const fallback = window.document.createElement('div');
      slot.append(fallback);
      shadow.append(slot);

      for (const child of host.childNodes) expect(standardDOM.flatTreeParent(child)).toBe(slot);
      expect(standardDOM.flatTreeParent(fallback)).toBeNull();
      host.replaceChildren();
      expect(standardDOM.flatTreeParent(fallback)).toBe(slot);
    } finally { window.close(); }
  });
});
