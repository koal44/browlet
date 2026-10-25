import { styleletEnv } from '../../environment-fixture';
import { parseURL } from '../../url-fixture';
import { describe, expect, it } from 'vitest';
import { ValueStage } from '../../../../src/stylelet/value-processing/stage';
import { TokenCursor } from '../../../../src/stylelet/syntax/token-cursor';
import { parseListOfComponentValues } from '../../../../src/stylelet/syntax/parser';
import { BadUrlToken, RightParenToken, identToken, TokenKind } from '../../../../src/stylelet/syntax/tokens';
import { UrlValue } from '../../../../src/stylelet/values/url';

describe('url', () => {
  it.each(['#paint', '#xywh=0,0,10,10'])(
    'sets the local URL flag on the fragment-only URL %j',
    (fragment) => {
      expect(UrlValue.parse(`url("${fragment}")`, {}))
        .toHaveProperty('repr.local', true);
    },
  );

  it('resolves a relative URL against its computed-value context', () => {
    const value = UrlValue.parse('url("../image.png")', {})!;

    expect(value.resolve(ValueStage.Computed, {
      env: styleletEnv,
      baseUrl: parseURL('https://example.com/styles/site.css')!,
    })).toEqual(new UrlValue({
      ...value.repr,
      href: 'https://example.com/image.png',
    }));
  });

  it('does not resolve a URL before the computed-value stage', () => {
    const value = UrlValue.parse('url("image.png")', {})!;

    expect(value.resolve(ValueStage.Specified, {
      env: styleletEnv,
      baseUrl: parseURL('https://example.com/styles/site.css')!,
    })).toBe(value);
  });

  it.each(['url("")', 'src("")', 'url("#fragment")'])(
    'preserves the special computed URL %j',
    (input) => {
      const value = UrlValue.parse(input, {})!;

      expect(value.resolve(ValueStage.Computed, {
        env: styleletEnv,
        baseUrl: parseURL('https://example.com/styles/site.css')!,
      })).toBe(value);
    },
  );

  it('retains a relative URL when no base URL is available', () => {
    const value = UrlValue.parse('url("image.png")', {})!;

    expect(value.resolve(ValueStage.Computed, { env: styleletEnv })).toBe(value);
  });

  it('retains an invalid URL when parsing fails', () => {
    const value = UrlValue.parse('url("http://[")', {})!;

    expect(value.resolve(ValueStage.Computed, { env: styleletEnv })).toBe(value);
  });

  it('preserves substitution in src() but not in url()', () => {
    expect(parseListOfComponentValues('src(var(--foo))', {}).tokens).toMatchObject([
      {
        type: TokenKind.FunctionBlock,
        name: 'src',
        value: {
          tokens: [
            {
              type: TokenKind.FunctionBlock,
              name: 'var',
              value: { tokens: [identToken('--foo')] },
            },
          ],
        },
      },
    ]);

    expect(parseListOfComponentValues('url(var(--foo))', {}).tokens).toEqual([
      BadUrlToken,
      RightParenToken,
    ]);
  });

  it.each([
    ['url(image.png)', 'url', 'image.png', false],
    ['url("image.png")', 'url', 'image.png', false],
    ['src("image.png")', 'src', 'image.png', false],
    ['URL("image.png")', 'url', 'image.png', false],
    ['SrC("image.png")', 'src', 'image.png', false],
    ['url()', 'url', '', false],
    ['url("")', 'url', '', false],
    ['src("")', 'src', '', false],
    ['url(#fragment)', 'url', '#fragment', true],
  ] as const)('parses %j', (input, notation, value, local) => {
    expect(UrlValue.parse(input, {})).toEqual(new UrlValue({ notation, href: value, modifiers: {}, ...(local ? { local: true } : {}) }));
  });

  it.each([
    ['url(image.png)', 'url("image.png")'],
    ['url("image.png")', 'url("image.png")'],
    ['src("image.png")', 'src("image.png")'],
    ['url()', 'url("")'],
    ['url(#fragment)', 'url("#fragment")'],
    [String.raw`url("a\"b\\c")`, String.raw`url("a\"b\\c")`],
    ['url("image.png" future-modifier())', 'url("image.png")'],
  ])('serializes %j as %j', (input, expected) => {
    expect(UrlValue.parse(input, {})!.serialize()).toBe(expected);
  });

  it('serializes request URL modifiers in grammar order', () => {
    const value = UrlValue.parse([
      'url("image.png"',
      'referrer-policy(no-referrer)',
      'integrity("sha256-test")',
      'cross-origin(use-credentials))',
    ].join(' '), {})!;

    expect(value.serialize()).toBe([
      'url("image.png"',
      'cross-origin(use-credentials)',
      'integrity("sha256-test")',
      'referrer-policy(no-referrer))',
    ].join(' '));
  });

  it('is idempotent after canonical serialization', () => {
    const value = UrlValue.parse([
      'src("image.png"',
      'referrer-policy(origin)',
      'cross-origin(anonymous))',
    ].join(' '), {})!;
    const serialized = value.serialize();

    expect(UrlValue.parse(serialized, {})!.serialize()).toBe(serialized);
  });

  it('retains request modifiers when resolving the URL against a base', () => {
    const specified = UrlValue.parse(
      'url("image.png" integrity("sha256-test") cross-origin(anonymous) referrer-policy(no-referrer))', {},
    )!;
    const computed = specified.resolve(ValueStage.Computed, { env: styleletEnv, baseUrl: parseURL('https://example.com/')! });

    expect(computed.repr.modifiers).toBe(specified.repr.modifiers);
    expect(computed.repr.modifiers.crossOrigin!.value).toBe('anonymous');
    expect(computed.serialize()).toBe(
      'url("https://example.com/image.png" cross-origin(anonymous) integrity("sha256-test") referrer-policy(no-referrer))',
    );
    expect(specified.repr.href).toBe('image.png');
  });

  it('accepts component trivia around and inside functional notation', () => {
    expect(UrlValue.parse(' /* before */ src( /* inner */ "image.png" ) /* after */ ', {}))
      .toEqual(new UrlValue({ notation: 'src', href: 'image.png', modifiers: {} }));
  });

  it.each([
    'url("image.png" cross-origin)',
    'url("image.png" future-modifier())',
    'url("image.png" unknown another-unknown())',
  ])('ignores unrecognized URL modifiers in %j', (input) => {
    expect(UrlValue.parse(input, {})).toEqual(new UrlValue({ notation: 'url', href: 'image.png', modifiers: {} }));
  });

  it('projects recognized request URL modifiers into their grammar fields', () => {
    expect(UrlValue.parse([
      'url("image.png"',
      'referrer-policy(no-referrer)',
      'unknown',
      'integrity("sha256-test")',
      'cross-origin(use-credentials))',
    ].join(' '), {})!.repr).toEqual({
      notation: 'url', href: 'image.png', modifiers: {
        crossOrigin: { type: 'cross-origin-modifier', value: 'use-credentials' },
        integrity: { type: 'integrity-modifier', value: 'sha256-test' },
        referrerPolicy: { type: 'referrer-policy-modifier', value: 'no-referrer' },
      },
    });
  });

  it.each([
    'url("image.png" integrity("first") integrity("second"))',
    [
      'url("image.png"',
      'cross-origin(anonymous)',
      'unknown',
      'referrer-policy(no-referrer)',
      'CROSS-ORIGIN(use-credentials))',
    ].join(' '),
  ])('rejects the duplicate request URL modifier in %j', (input) => {
    expect(UrlValue.parse(input, {})).toBeNull();
  });

  it('commits after consuming a duplicate request URL modifier', () => {
    const c = new TokenCursor(parseListOfComponentValues([
      'src("image.png"',
      'referrer-policy(no-referrer)',
      'unknown()',
      'REFERRER-POLICY(origin))',
    ].join(' '), {}), {});

    expect(UrlValue.consume(c)).toBeNull();
    expect(c.pos()).toBe(0);
  });

  it('rejects an unknown functional modifier containing a bad token', () => {
    expect(UrlValue.parse('url("image.png" future-modifier("bad\n))', {})).toBeNull();
  });

  it.each([
    '',
    '"image.png"',
    'src(image.png)',
    'src()',
    'src(var(--image))',
    'url(var(--image))',
    'url("image.png" 1px)',
    'url(foo"bar)',
  ])('rejects %j', (input) => {
    expect(UrlValue.parse(input, {})).toBeNull();
  });

  it('commits after recognizing a function with invalid arguments', () => {
    const c = new TokenCursor(
      parseListOfComponentValues('url("image.png" 1px)', {}), {},
    );
    const result = UrlValue.consume(c);

    expect(result).toBeNull();
    expect(c.pos()).toBe(0);
  });
});
