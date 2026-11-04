import { describe, expect, it } from 'vitest';

import { touchActionProperty, TouchActionValue } from '../../../../src/stylelet/props/built-in/touch-action';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { styleletEnv } from '../../environment-fixture';

describe('Pointer Events §7.1 / Compatibility §3.5.1: touch-action values', () => {
  it.each([
    ['auto', 'auto'], ['none', 'none'], ['manipulation', 'manipulation'],
    ['pan-x', 'pan-x'], ['pan-left', 'pan-left'], ['pan-right', 'pan-right'],
    ['pan-y', 'pan-y'], ['pan-up', 'pan-up'], ['pan-down', 'pan-down'], ['pinch-zoom', 'pinch-zoom'],
    ['pan-y pan-x', 'pan-x pan-y'], ['pan-up pan-left', 'pan-left pan-up'],
    ['pan-down pan-right', 'pan-right pan-down'], ['pan-y pan-right', 'pan-right pan-y'],
    ['pan-x pan-down', 'pan-x pan-down'], ['pinch-zoom pan-y', 'pan-y pinch-zoom'],
    ['pinch-zoom pan-left', 'pan-left pinch-zoom'],
    ['pan-y pan-x pinch-zoom', 'pan-x pan-y pinch-zoom'],
    ['pinch-zoom pan-up pan-right', 'pan-right pan-up pinch-zoom'],
    ['PAN-Y PAN-X', 'pan-x pan-y'], [' /*before*/ pan-y/**/pan-left /*after*/ ', 'pan-left pan-y'],
    [String.raw`p\61 n-y p\61 n-x`, 'pan-x pan-y'],
  ])('parses and computes %s as %s', (input, expected) => {
    const declared = touchActionProperty.parse(input, { env: styleletEnv })!;
    expect(declared).not.toBeNull();
    expect(declared.serialize()).toBe(expected);
    const computed = touchActionProperty.resolve(declared, ValueStage.Computed, { env: styleletEnv });
    expect(computed.serialize()).toBe(expected);
    expect(declared.serialize()).toBe(expected);
  });

  it.each([
    '', 'pan', 'zoom', '10%', '"none"', 'none pan-x', 'auto pinch-zoom', 'manipulation pan-y',
    'none none', 'pan-x pan-x', 'pinch-zoom pinch-zoom', 'pan-left pan-right', 'pan-x pan-left',
    'pan-up pan-down', 'pan-y pan-up', 'pan-x pan-y pan-down', 'pan-x, pan-y',
    'pan-x / pan-y', 'pan-x unknown', 'pan-x !important',
  ])('rejects an invalid complete value: %s', (input) => {
    expect(touchActionProperty.parse(input, { env: styleletEnv })).toBeNull();
  });

  it('leaves CSS-wide values to the shared whole-value parser', () => {
    for (const keyword of ['initial', 'inherit', 'unset', 'revert', 'revert-layer']) {
      expect(TouchActionValue.parse(keyword, { env: styleletEnv })).toBeNull();
      expect(touchActionProperty.parse(keyword, { env: styleletEnv })!.serialize()).toBe(keyword);
    }
  });

  it('does not contribute to animation interpolation, addition, or accumulation', () => {
    const from = touchActionProperty.parse('none', { env: styleletEnv })!;
    const to = touchActionProperty.parse('pan-x', { env: styleletEnv })!;
    expect(touchActionProperty.interpolate(from, to, 0.5, { env: styleletEnv })).toBeNull();
    expect(touchActionProperty.add(from, to, { env: styleletEnv })).toBeNull();
    expect(touchActionProperty.accumulate(from, to, { env: styleletEnv })).toBeNull();
  });
});
