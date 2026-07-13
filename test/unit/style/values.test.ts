import { describe, expect, it } from 'vitest';
import { parseStylesheet } from '../../../src/stylelet/parser/ast';
import { parseListOfComponentValues } from '../../../src/stylelet/parser/syntax';
import { BlockItemAstKind, type StyleRuleAst } from '../../../src/stylelet/parser/types';
import { serializeAnPlusB } from '../../../src/stylelet/values/an-plus-b';
import { parseAnyValue } from '../../../src/stylelet/values/any-value';
import { parseDeclarationValue } from '../../../src/stylelet/values/declaration-value';

describe('An+B', () => {
  it.each([
    [{ a: 0, b: 3 }, '3'],
    [{ a: 1, b: 0 }, 'n'],
    [{ a: -1, b: 3 }, '-n+3'],
    [{ a: 2, b: -1 }, '2n-1'],
    [{ a: -2, b: 0 }, '-2n'],
    [{ a: 0, b: -0 }, '0'],
  ] as const)('serializes %j as %s', (value, expected) => {
    expect(serializeAnPlusB(value)).toBe(expected);
  });
});

describe('any-value', () => {
  it('parses a nonempty sequence of arbitrary component values', () => {
    const expected = parseListOfComponentValues('a ! b; fn() []');
    expect(parseAnyValue('a ! b; fn() []')).toEqual(expected);
  });

  it('returns the original component values after validating them', () => {
    const components = parseListOfComponentValues('a fn(b)');
    expect(parseAnyValue(components)).toBe(components);
  });

  it('accepts empty nested block contents', () => {
    expect(parseAnyValue('fn()')).not.toBeNull();
    expect(parseAnyValue('[]')).not.toBeNull();
  });

  it('rejects an empty production', () => {
    expect(parseAnyValue('')).toBeNull();
  });

  it('rejects bad tokens recursively', () => {
    expect(parseAnyValue('"x\ny"')).toBeNull();
    expect(parseAnyValue('fn("x\ny")')).toBeNull();
    expect(parseAnyValue('url(foo"bar)')).toBeNull();
    expect(parseAnyValue('fn(url(foo"bar))')).toBeNull();
  });

  it('rejects unmatched closing tokens recursively', () => {
    expect(parseAnyValue(')')).toBeNull();
    expect(parseAnyValue(']')).toBeNull();
    expect(parseAnyValue('}')).toBeNull();
    expect(parseAnyValue('fn(])')).toBeNull();
    expect(parseAnyValue('[)]')).toBeNull();
  });
});

describe('declaration-value', () => {
  const values = parseListOfComponentValues;

  it('parses a nonempty sequence of declaration component values', () => {
    const components = values('red 1px url(foo.png)');
    expect(parseDeclarationValue(components)).toBe(components);
  });

  it('rejects an empty production', () => {
    expect(parseDeclarationValue('')).toBeNull();
  });

  it('rejects top-level semicolons and bangs', () => {
    expect(parseDeclarationValue('a ! b')).toBeNull();
    expect(parseDeclarationValue('a; b')).toBeNull();
  });

  it('allows semicolons and bangs inside blocks', () => {
    expect(parseDeclarationValue('fn(a ! b; c)')).not.toBeNull();
    expect(parseDeclarationValue('[a ! b; c]')).not.toBeNull();
    expect(parseDeclarationValue('(a ! b; c)')).not.toBeNull();
  });

  it('rejects invalid component values recursively', () => {
    expect(parseDeclarationValue('"x\ny"')).toBeNull();
    expect(parseDeclarationValue('fn(url(foo"bar))')).toBeNull();
    expect(parseDeclarationValue('fn(])')).toBeNull();
    expect(parseDeclarationValue('[)]')).toBeNull();
  });
});

// This is unfinished!! we'll come back to it later. promise.
describe.skip('animation-name', () => {
  const animationName = (...values: unknown[]) => ({
    type: 'animation-name',
    values,
  });

  const none = () => ({ type: 'none' });
  const customIdent = (value: string) => ({ type: 'custom-ident', value });
  const stringValue = (value: string) => ({ type: 'string', value });

  function valueOf(css: string): unknown {
    const sheet = parseStylesheet(`.foo { ${css} }`);
    const rule = sheet.rules[0] as StyleRuleAst | undefined;

    const item = rule?.block.items[0];

    if (item?.kind !== BlockItemAstKind.Declaration) {
      return undefined;
    }

    return item.value;
  }

  it('parses none', () => {
    expect(valueOf('animation-name: none;')).toMatchObject(
      animationName(none()),
    );
  });

  it('parses a custom ident keyframes name', () => {
    expect(valueOf('animation-name: fade-in;')).toMatchObject(
      animationName(customIdent('fade-in')),
    );
  });

  it('parses a string keyframes name', () => {
    expect(valueOf('animation-name: "fade-in";')).toMatchObject(
      animationName(stringValue('fade-in')),
    );
  });

  it('parses comma-separated animation names', () => {
    expect(valueOf('animation-name: fade-in, "slide", none;')).toMatchObject(
      animationName(
        customIdent('fade-in'),
        stringValue('slide'),
        none(),
      ),
    );
  });

  it('drops invalid animation-name declarations', () => {
    const cases = [
      'animation-name: ;',
      'animation-name: 1;',
      'animation-name: 1px;',
      'animation-name: var(--x);',
      'animation-name: fade-in,;',
      'animation-name: fade-in,, slide;',
    ];

    for (const css of cases) {
      expect(valueOf(css)).toBeUndefined();
    }
  });
});
