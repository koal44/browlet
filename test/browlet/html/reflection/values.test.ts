import { describe, expect, it } from 'vitest';
import { DOMTokenListImpl } from '../../../../src/browlet/dom/token-list';
import { createReflectionFixture, tokensAttribute } from './fixture';

describe('HTML reflected values through Web IDL', () => {
  it('selects attribute names, canonical keywords, and nullable deletion', () => {
    const { platform: element } = createReflectionFixture();
    expect([element.camelCase, element.keyword, element.optionalKeyword]).toEqual(['', '', null]);
    element.camelCase = 'text';
    element.renamed = 'named';
    element.keyword = 'YES';
    element.optionalKeyword = 'YES';
    expect([element.getAttribute('camelcase'), element.getAttribute('data-name'), element.keyword, element.optionalKeyword])
      .toEqual(['text', 'named', 'enabled', 'enabled']);
    expect(element.getAttribute('keyword')).toBe('YES');
    element.optionalKeyword = null;
    expect(element.hasAttribute('optionalkeyword')).toBe(false);
    Reflect.set(element, 'keyword', null);
    expect([element.keyword, element.getAttribute('keyword')]).toEqual(['', 'null']);
  });

  it('converts scalar strings, resolves URLs against the node document, and preserves a custom getter', () => {
    const { platform: element, document, env } = createReflectionFixture();
    document.setURL(env.parseURL('https://example.test/dir/page')!);
    expect(element.url).toBe('');
    element.setAttribute('scalar', '\uD800');
    expect(element.scalar).toBe('\uFFFD');
    element.url = '../other';
    expect([element.url, element.getAttribute('url')]).toEqual(['https://example.test/other', '../other']);
    element.url = 'https://[';
    expect(element.url).toBe('https://[');
    element.custom = 'stored';
    expect([element.custom, element.getAttribute('custom')]).toEqual(['custom:stored', 'stored']);
  });

  it('performs author conversion once and treats boolean text as presence', () => {
    const { platform: element } = createReflectionFixture();
    let calls = 0;
    Reflect.set(element, 'camelCase', { toString() { calls++; return 'value'; } });
    expect(calls).toBe(1);
    element.setAttribute('present', 'false');
    expect(element.present).toBe(true);
    Reflect.set(element, 'present', '');
    expect(element.hasAttribute('present')).toBe(false);
    Reflect.set(element, 'present', {});
    expect(element.getAttribute('present')).toBe('');
  });

  it.each([
    ['signed', null, 0], ['signed', ' -2147483648tail', -2147483648], ['signed', '2147483648', 0],
    ['nonnegative', null, -1], ['nonnegative', '-1', -1], ['nonnegative', '-0', 0],
    ['unsigned', '2147483647', 2147483647], ['unsigned', '2147483648', 0],
    ['positive', '0', 1], ['fallback', '0', 20], ['fallback', null, 20],
    ['ranged', '0', 2], ['ranged', '99999999999999999999999999999999', 10],
    ['ranged', '-1', 4], ['ranged', '7tail', 7], ['floating', ' 1.5tail', 1.5],
    ['floating', '1e999', 0], ['floating', '-3', -3], ['positiveFloat', '-3', 1.5],
  ] as const)('reads %s=%s as %s', (name, text, expected) => {
    const { platform: element } = createReflectionFixture();
    if (text !== null) element.setAttribute(name.toLowerCase(), text);
    expect(element[name]).toBe(expected);
  });

  it('applies Web IDL conversion before numeric setter restrictions; ranges clamp only getters', () => {
    const { platform: element, realm } = createReflectionFixture();
    element.signed = 4294967295;
    expect([element.signed, element.getAttribute('signed')]).toEqual([-1, '-1']);
    expect(() => { element.nonnegative = -1; }).toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
    expect(() => { element.positive = 0; }).toThrow(expect.objectContaining({ name: 'IndexSizeError' }));
    element.fallback = 0;
    element.unsigned = -1;
    element.ranged = 100;
    expect([element.getAttribute('fallback'), element.getAttribute('unsigned'), element.getAttribute('ranged'), element.ranged])
      .toEqual(['20', '0', '100', 10]);
    element.positiveFloat = 2.5;
    element.positiveFloat = 0;
    expect(element.getAttribute('positivefloat')).toBe('2.5');
    expect(() => { element.floating = Infinity; }).toThrow(realm.TypeError);
    expect(() => { element.floating = NaN; }).toThrow(realm.TypeError);
    expect(element.hasAttribute('floating')).toBe(false);
  });

  it('retains token-list identity and follows raw, attached Attr, and PutForwards writes', () => {
    const { platform: element } = createReflectionFixture();
    const tokens = element.tokens;
    expect(tokens.supports('RENDER')).toBe(true);
    Reflect.set(element, 'tokens', 'a b');
    expect([...tokens]).toEqual(['a', 'b']);
    element.getAttributeNode('tokens')!.value = 'c c';
    expect([...tokens]).toEqual(['c']);
    element.setAttributeNS('urn:other', 'x:tokens', 'd');
    expect([...tokens]).toEqual(['c']);
    element.removeAttribute('tokens');
    expect(element.tokens).toBe(tokens);
    expect(tokens.length).toBe(0);
  });

  it.each([true, false])('shares the attribute definition with internal callers (internal first: %s)', (internalFirst) => {
    const { element, platform, context } = createReflectionFixture();
    const internal = internalFirst ? element.getAttributeTokenList(tokensAttribute) : undefined;
    const tokens = platform.tokens;
    const list = internal ?? element.getAttributeTokenList(tokensAttribute);
    expect(context.project(DOMTokenListImpl, list)).toBe(tokens);
    expect(tokens.supports('RENDER')).toBe(true);
    list.add('custom');
    expect(tokens.value).toBe('custom');
    expect(element.getAttributeTokenList(tokensAttribute)).toBe(list);
  });

  it('distinguishes missing and empty supported-token definitions without restricting stored tokens', () => {
    const { platform: element, realm } = createReflectionFixture();
    const plain = element.plainTokens;
    const empty = element.emptyTokens;
    plain.add('custom');
    empty.add('custom');
    expect(element.getAttribute('plaintokens')).toBe('custom');
    expect(element.getAttribute('emptytokens')).toBe('custom');
    expect(() => plain.supports('custom')).toThrow(realm.TypeError);
    expect(empty.supports('custom')).toBe(false);
    element.setAttribute('plaintokens', 'updated');
    expect(element.plainTokens).toBe(plain);
    expect([...plain]).toEqual(['updated']);
  });
});
