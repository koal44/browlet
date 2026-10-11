import { describe, expect, it } from 'vitest';

import { InternalError } from '../../../../src/infra/internal-error';
import { EnumeratedAttribute } from '../../../../src/browlet/html/microsyntaxes/index';

describe('HTML enumerated attribute states', () => {
  it('uses only the missing-value default for an absent attribute', () => {
    const withMissing = new EnumeratedAttribute([], {
      missingValueDefault: 'missing', emptyValueDefault: 'empty', invalidValueDefault: 'invalid',
    });
    const withoutMissing = new EnumeratedAttribute([], {
      emptyValueDefault: 'empty', invalidValueDefault: 'invalid',
    });

    expect(withMissing.getState(null)).toBe('missing');
    expect(withoutMissing.getState(null)).toBe(null);
  });

  it('matches keywords case-insensitively in ASCII, without changing their canonical spelling', () => {
    const attribute = new EnumeratedAttribute([
      { state: 'known', keywords: ['MixedCase'] },
    ]);

    expect(attribute.getState('mixedcase')).toBe('known');
    expect(attribute.getState('MIXEDCASE')).toBe('known');
    expect(attribute.getCanonicalKeyword('known')).toBe('MixedCase');
  });

  it('does not trim values or fold non-ASCII letters', () => {
    const attribute = new EnumeratedAttribute([
      { state: 'known', keywords: ['keyword'] },
    ], { invalidValueDefault: 'invalid' });

    for (const value of [' keyword', 'keyword ', '\tkeyword', 'keyword\n', 'Keyword']) {
      expect(attribute.getState(value)).toBe('invalid');
      expect(attribute.isValidValue(value)).toBe(false);
    }
  });

  it('recognizes an explicit empty keyword before either fallback', () => {
    const attribute = new EnumeratedAttribute([
      { state: 'keyword', keywords: [''] },
    ], { emptyValueDefault: 'empty', invalidValueDefault: 'invalid' });

    expect(attribute.getState('')).toBe('keyword');
    expect(attribute.getCanonicalKeyword('keyword')).toBe('');
  });

  it('uses the empty-value default before the invalid-value default', () => {
    const attribute = new EnumeratedAttribute([], {
      emptyValueDefault: 'empty', invalidValueDefault: 'invalid',
    });

    expect(attribute.getState('')).toBe('empty');
    expect(attribute.isValidValue('')).toBe(true);
    expect(attribute.getState(' ')).toBe('invalid');
    expect(attribute.isValidValue(' ')).toBe(false);
  });

  it('falls through to the invalid-value default, or no state when it is absent', () => {
    const withInvalid = new EnumeratedAttribute([], { invalidValueDefault: 'invalid' });
    const withoutInvalid = new EnumeratedAttribute([]);

    for (const value of ['', 'unknown', '__proto__', 'constructor', 'toString']) {
      expect(withInvalid.getState(value)).toBe('invalid');
      expect(withoutInvalid.getState(value)).toBe(null);
      expect(withInvalid.isValidValue(value)).toBe(false);
    }
  });

  it('recognizes non-conforming aliases without treating them as valid authoring syntax', () => {
    const attribute = new EnumeratedAttribute([
      { state: 'enabled', keywords: ['on'], nonConformingKeywords: ['legacy'] },
    ]);

    expect(attribute.getState('ON')).toBe('enabled');
    expect(attribute.getState('LEGACY')).toBe('enabled');
    expect(attribute.isValidValue('ON')).toBe(true);
    expect(attribute.isValidValue('LEGACY')).toBe(false);
    expect(attribute.getCanonicalKeyword('enabled')).toBe('on');
  });

  it('retains falsy states instead of confusing them with missing defaults', () => {
    const attribute = new EnumeratedAttribute<0 | ''>([
      { state: 0, keywords: ['zero'] },
      { state: '', keywords: ['blank'] },
    ], { missingValueDefault: 0, emptyValueDefault: '', invalidValueDefault: 0 });

    expect(attribute.getState('zero')).toBe(0);
    expect(attribute.getState('blank')).toBe('');
    expect(attribute.getState(null)).toBe(0);
    expect(attribute.getState('')).toBe('');
    expect(attribute.getState('unknown')).toBe(0);
  });
});

describe('HTML canonical keywords', () => {
  it('uses the sole keyword even when it is non-conforming', () => {
    const attribute = new EnumeratedAttribute([
      { state: 'legacy', keywords: [], nonConformingKeywords: ['old'] },
    ]);

    expect(attribute.getCanonicalKeyword('legacy')).toBe('old');
    expect(attribute.isValidValue('old')).toBe(false);
  });

  it.each([
    { keywords: ['', 'true'] },
    { keywords: ['true', ''] },
  ])('prefers the nonempty of two conforming keywords: $keywords', ({ keywords }) => {
    const attribute = new EnumeratedAttribute([
      { state: 'enabled', keywords, nonConformingKeywords: ['yes'] },
    ]);

    expect(attribute.getCanonicalKeyword('enabled')).toBe('true');
    expect(attribute.getState('')).toBe('enabled');
  });

  it('uses an explicit canonical keyword when several conforming spellings remain', () => {
    const attribute = new EnumeratedAttribute([
      { state: 'enabled', keywords: ['', 'true', 'on'], canonicalKeyword: 'on' },
    ]);

    expect(attribute.getCanonicalKeyword('enabled')).toBe('on');
    for (const value of ['', 'true', 'on']) {
      expect(attribute.getState(value)).toBe('enabled');
      expect(attribute.isValidValue(value)).toBe(true);
    }
  });

  it('requires the owner to supply a canonical keyword when the automatic rules cannot choose', () => {
    expect(() => new EnumeratedAttribute([
      { state: 'enabled', keywords: ['true', 'on'] },
    ])).toThrow(InternalError);
  });

  it('has no canonical keyword for a state without any keyword', () => {
    const attribute = new EnumeratedAttribute([
      { state: 'default', keywords: [] },
    ], { missingValueDefault: 'default' });

    expect(attribute.getState(null)).toBe('default');
    expect(attribute.getCanonicalKeyword('default')).toBe(null);
  });
});
