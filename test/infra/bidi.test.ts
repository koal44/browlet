import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type * as BidiModule from '../../src/infra/bidi';
import { firstStrongDirection } from '../../src/infra/bidi';

describe('first strong Unicode direction', () => {
  it.each([
    ['', null], ['123!? \n', null], ['Aא', 'ltr'], ['אA', 'rtl'], ['اA', 'rtl'],
    ['\u0661A', 'ltr'], ['\u05b0A', 'ltr'], ['\u0610A', 'ltr'], ['中א', 'ltr'],
    ['\u200fA', 'rtl'], ['\u200eא', 'ltr'], ['\u061cA', 'rtl'],
    ['\u202bA', 'ltr'], ['\u2067A', 'ltr'], ['\u{1e900}A', 'rtl'],
    ['\u{10400}א', 'ltr'], ['\u{1f600}א', 'rtl'], ['\ud800א', 'ltr'],
    // Unassigned points retain Unicode's explicit per-block defaults.
    ['\u0590A', 'rtl'], ['\u0378א', 'ltr'], ['\uffffא', 'rtl'],
    // Assigned non-strong characters split otherwise adjacent strong ranges.
    ['\u{113d2}א', 'rtl'], ['\u{1e5ee}א', 'rtl'], ['\u{1e5ef}א', 'rtl'], ['\u{1e2ff}א', 'rtl'],
  ] satisfies [string, 'ltr' | 'rtl' | null][])('classifies %j as %j', (text, expected) => {
    expect(firstStrongDirection(text)).toBe(expected);
  });

  it('preserves the Unicode 17 classification of every code point', () => {
    const classes = new Uint8Array(0x110000);
    for (let point = 0; point < classes.length; point++) {
      const direction = firstStrongDirection(String.fromCodePoint(point));
      classes[point] = direction === 'ltr' ? 1 : direction === 'rtl' ? 2 : 0;
    }
    // Captured before packing, including DerivedBidiClass's defaults for unassigned points.
    expect(createHash('sha256').update(classes).digest('hex'))
      .toBe('7f5cff54209cae188c7834e1c5a7549683405f18edc1ac18e533cf737002d4b5');
  });

  it('decodes once on the first nonempty lookup, not during module loading', async () => {
    const base64 = await import('../../src/infra/base64.js');
    const decode = vi.spyOn(base64, 'forgivingBase64Decode');
    try {
      // Refresh only this module; resetting the shared module cache would lose
      // Browlet's installation state while its native host hooks remain installed.
      const freshModule = '../../src/infra/bidi.js?cold-start';
      const bidi = await import(freshModule) as typeof BidiModule;
      expect(decode).not.toHaveBeenCalled();
      expect(bidi.firstStrongDirection('')).toBeNull();
      expect(decode).not.toHaveBeenCalled();
      expect(bidi.firstStrongDirection('א')).toBe('rtl');
      expect(bidi.firstStrongDirection('A')).toBe('ltr');
      expect(decode).toHaveBeenCalledTimes(1);
    } finally { decode.mockRestore(); }
  });
});
