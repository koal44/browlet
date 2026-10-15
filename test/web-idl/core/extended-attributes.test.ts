import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  decimal, hasExtendedAttribute, reflect, reflectEnumerated, reflectPositive, reflectTokens, xattr,
  type ReflectionExtendedAttribute,
} from '../../../src/web-idl/core/index';

describe('reflection declaration metadata', () => {
  it('keeps the default and range inside one reflection annotation through lookup', () => {
    const reflection = reflect({ default: 4, range: [2, 10] });
    const { extendedAttributes } = xattr(reflection);
    const found = extendedAttributes.find((attribute) => attribute.kind === 'reflection');

    expectTypeOf(found).toEqualTypeOf<ReflectionExtendedAttribute | undefined>();
    expectTypeOf(found?.default).toEqualTypeOf<ReflectionExtendedAttribute['default']>();
    expectTypeOf(found!.range).toEqualTypeOf<[minimum: string, maximum: string] | undefined>();
    expect(extendedAttributes).toEqual([reflection]);
    expect(found).toBe(reflection);
    expect(found?.default).toEqual({ kind: 'integer', value: '4' });
    expect(found?.range).toEqual(['2', '10']);
    expect(hasExtendedAttribute(extendedAttributes, 'ReflectDefault')).toBe(false);
    expect(hasExtendedAttribute(extendedAttributes, 'ReflectRange')).toBe(false);
  });

  it('retains explicit decimal spelling and infers fractional defaults', () => {
    const fallback = decimal('1.0');
    expect(reflectPositive({ default: fallback }).default).toBe(fallback);
    expect(reflectPositive({ default: 1.5 }).default).toEqual({ kind: 'decimal', value: '1.5' });
  });

  it('retains optional payloads in declaration order', () => {
    const tokenList = { name: 'blocking', supportedTokens: new Set(['render']) };
    const tokens = reflectTokens(tokenList);
    const enumerated = reflectEnumerated({ owner: 'HTML' });
    const { extendedAttributes } = xattr('CEReactions', tokens, enumerated);
    const found = extendedAttributes.find((attribute) => attribute.kind === 'reflection');

    expectTypeOf(found).toEqualTypeOf<ReflectionExtendedAttribute | undefined>();
    expect(found).toBe(tokens);
    expectTypeOf(found?.tokenList).toEqualTypeOf<unknown>();
    expect(found?.tokenList).toBe(tokenList);
    expect(enumerated.enumerated).toEqual({ owner: 'HTML' });
  });

  it('preserves generic annotations, skips raw syntax, and reports absence', () => {
    const { extendedAttributes } = xattr({ kind: 'raw', value: 'ReflectDefault=1' }, ['Custom', 'value']);
    expect(hasExtendedAttribute(extendedAttributes, 'Custom')).toBe(true);
    expect(hasExtendedAttribute(extendedAttributes, 'ReflectDefault')).toBe(false);
    expect(extendedAttributes.find((attribute) => attribute.kind === 'reflection')).toBeUndefined();
  });
});
