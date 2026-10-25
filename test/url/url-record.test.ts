import { describe, expect, it } from 'vitest';

import { aboutBlankURL, parseURL } from '../../src/url/url';
import { copyURL, serializeURL } from '../../src/url/core/index';

describe('URL records', () => {
  it('provides a frozen about:blank template matching the parser and independent mutable copies', () => {
    expect(aboutBlankURL).toEqual(parseURL('about:blank').url);
    expect(Object.isFrozen(aboutBlankURL)).toBe(true);

    const first = copyURL(aboutBlankURL);
    const second = copyURL(aboutBlankURL);
    first.fragment = 'first';
    second.query = 'second';
    expect(serializeURL(first)).toBe('about:blank#first');
    expect(serializeURL(second)).toBe('about:blank?second');
    expect(serializeURL(aboutBlankURL)).toBe('about:blank');
  });
});
