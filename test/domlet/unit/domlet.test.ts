import { describe, expect, it } from 'vitest';

import { createDomlet } from '../../../src/domlet/domlet';

describe('createDomlet', () => {
  it('lazily associates one CSS engine with its document', () => {
    const document = createDomlet({
      source: '<main id="target"></main>',
    });
    const cssEngine = document.cssEngine;

    expect(document.cssEngine).toBe(cssEngine);
    expect(cssEngine.snapshot.document).toBe(document);
    expect(cssEngine.snapshot.root).toBe(document.documentElement);
    expect(cssEngine.snapshot.isQuirksMode).toBe(true);
    expect(cssEngine.version).toBe('stylelet-__VERSION__');
    expect(document.documentElement.localName).toBe('html');
    expect(document.getElementById('target')?.localName).toBe('main');
  });
});
