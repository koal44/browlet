import { describe, expect, it } from 'vitest';

import { createDomlet } from '../../../src/domlet/domlet';

describe('createDomlet', () => {
  it('parses an HTML document through the Domlet facade', () => {
    const document = createDomlet('<main id="target"></main>');

    expect(document.documentElement?.localName).toBe('html');
    expect(document.getElementById('target')?.localName).toBe('main');
  });
});
