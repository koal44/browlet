import { describe, expect, it } from 'vitest';

import { Domlet } from '../../../src/domlet/domlet';
import { DocumentImpl } from '../../../src/domlet/nodes/document';

describe('Domlet', () => {
  it('parses directly into DOM implementation objects', () => {
    const document = new Domlet().parse('<main id="target"></main>');

    expect(document).toBeInstanceOf(DocumentImpl);
    expect(document.getElementById('target')?.localName).toBe('main');
  });

  it('lazily associates one CSS engine with its document', () => {
    const document = new Domlet().parse('<main id="target"></main>');
    const cssEngine = DocumentImpl.getCSSEngine(document);

    expect(DocumentImpl.getCSSEngine(document)).toBe(cssEngine);
    expect(cssEngine.snapshot.document).toBe(document);
    expect(cssEngine.snapshot.root).toBe(document.documentElement);
    expect(cssEngine.snapshot.isQuirksMode).toBe(true);
    expect(cssEngine.version).toBe('stylelet-__VERSION__');
    expect(document.documentElement.localName).toBe('html');
    expect(document.getElementById('target')?.localName).toBe('main');
  });
});
