import { describe, expect, it } from 'vitest';
import { extendedLangMatch } from '../../src/selectlet/compile/runtime';

describe('extendedLangMatch', () => {
  it('matches Selectors 4 language ranges with intervening subtags', () => {
    expect(extendedLangMatch('cs-cz', 'cs-latn-cz')).toBe(true);
    expect(extendedLangMatch('de-de', 'de-latn-de')).toBe(true);
    expect(extendedLangMatch('de-de', 'de-de-1996')).toBe(true);
    expect(extendedLangMatch('de-de', 'de-latn-de-1996')).toBe(true);
  });

  it('keeps ordinary prefix language matching behavior', () => {
    expect(extendedLangMatch('cs', 'cs')).toBe(true);
    expect(extendedLangMatch('cs', 'cs-cz')).toBe(true);
    expect(extendedLangMatch('en', 'en-us')).toBe(true);
  });

  it('rejects different language or region subtags', () => {
    expect(extendedLangMatch('cs-cz', 'cs-sk')).toBe(false);
    expect(extendedLangMatch('cs-cz', 'sk-cz')).toBe(false);
    expect(extendedLangMatch('en-gb', 'en-us')).toBe(false);
  });

  it('does not skip extension singleton subtags', () => {
    expect(extendedLangMatch('en-us', 'en-x-us')).toBe(false);
    expect(extendedLangMatch('en-us', 'en-a-us')).toBe(false);
  });

  it('supports wildcard range subtags', () => {
    expect(extendedLangMatch('*', 'cs-latn-cz')).toBe(true);
    expect(extendedLangMatch('cs-*', 'cs-latn-cz')).toBe(true);
    expect(extendedLangMatch('cs-*-cz', 'cs-latn-cz')).toBe(true);
    expect(extendedLangMatch('cs-*-sk', 'cs-latn-cz')).toBe(false);
  });
});
