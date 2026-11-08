import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';

describe('HTML §8.3: Base64 utility methods', () => {
  const prepared = useFixture(() => new Browlet({ route: () => '' }));

  it('exposes the two global methods through ordinary Web IDL operations', async () => {
    expect(await prepared().evaluate(() => ['atob', 'btoa'].map((name) => {
      const method = Reflect.get(self, name) as typeof atob;
      const descriptor = Object.getOwnPropertyDescriptor(self, name)!;
      return [typeof method, method.name, method.length,
        descriptor.writable, descriptor.enumerable, descriptor.configurable];
    }))).toEqual([
      ['function', 'atob', 1, true, true, true],
      ['function', 'btoa', 1, true, true, true],
    ]);
  });

  it('encodes binary strings with canonical padding', async () => {
    const inputs = ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', '\0\x7f\x80\xff'];
    expect(await prepared().evaluate((values) => values.map((value) => btoa(value)), inputs)).toEqual([
      '', 'Zg==', 'Zm8=', 'Zm9v', 'Zm9vYg==', 'Zm9vYmE=', 'Zm9vYmFy', 'AH+A/w==',
    ]);
  });

  it('preserves every byte value through a binary-string round trip', async () => {
    expect(await prepared().evaluate(() => {
      const data = Array.from({ length: 256 }, (_, index) => String.fromCharCode(index)).join('');
      return atob(btoa(data)) === data;
    })).toBe(true);
  });

  it('rejects code points above U+00FF instead of truncating or UTF-8 encoding them', () => {
    const { window } = prepared();
    for (const value of ['\u0100', '\u20ac', '\ud800', '\udfff', '😀', 'prefix\u0100']) {
      expect(() => window.btoa(value)).toThrow(window.DOMException);
      expect(() => window.btoa(value)).toThrow(expect.objectContaining({ name: 'InvalidCharacterError', code: 5 }));
    }
  });

  it('decodes bytes, omitted padding, ASCII whitespace, and unused trailing bits', async () => {
    const inputs = ['', 'Zg==', 'Zg', 'Zm8=', 'Zm8', 'Zm9v', '\t Zm\n9v\fYm\rFy ', 'YR', 'YR==', 'AH+A/w=='];
    expect(await prepared().evaluate((values) => values.map((value) => atob(value)), inputs)).toEqual([
      '', 'f', 'f', 'fo', 'fo', 'foo', 'foobar', 'a', 'a', '\0\x7f\x80\xff',
    ]);
  });

  it('rejects invalid lengths, padding, alphabets, and non-ASCII whitespace', () => {
    const { window } = prepared();
    for (const value of ['A', '=', '==', 'Zg=', 'Zg===', 'Zm=v', 'Zg-_', 'Zg==\u00a0', 'Zg==\v', 'Zg==\0', '\u0100']) {
      expect(() => window.atob(value)).toThrow(window.DOMException);
      expect(() => window.atob(value)).toThrow(expect.objectContaining({ name: 'InvalidCharacterError', code: 5 }));
    }
  });

  it('uses DOMString conversion, including explicit undefined and null', async () => {
    expect(await prepared().evaluate(() => ({
      encoded: [undefined, null, 12].map((value) => Reflect.apply(btoa, self, [value]) as string),
      decoded: [null, 12].map((value) => Reflect.apply(atob, self, [value]) as string),
    }))).toEqual({ encoded: ['dW5kZWZpbmVk', 'bnVsbA==', 'MTI='], decoded: ['\x9e\xe9e', '\xd7'] });
  });

  it('converts each argument once and preserves a thrown conversion value', async () => {
    expect(await prepared().evaluate(() => {
      const failure = {};
      let conversions = 0;
      const value = { toString() { conversions++; return 'f'; } };
      const result = Reflect.apply(btoa, self, [value]) as string;
      const observed = [atob, btoa].map((method) => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- author conversion can throw any value
        try { Reflect.apply(method, self, [{ toString() { throw failure; } }]); }
        catch (error) { return error === failure; }
        return false;
      });
      return { result, conversions, observed };
    })).toEqual({ result: 'Zg==', conversions: 1, observed: [true, true] });
  });

  it('rejects missing arguments, Symbols, and construction in the method realm', () => {
    const { window } = prepared();
    const realm = getRelevantRealm(window);
    for (const name of ['atob', 'btoa'] as const) {
      const method = window[name];
      expect(() => { Reflect.apply(method, window, []); }).toThrow(realm.TypeError);
      expect(() => { Reflect.apply(method, window, [Symbol('input')]); }).toThrow(realm.TypeError);
      expect(() => { Reflect.construct(method, ['f']); }).toThrow(TypeError);
    }
  });

  it('accepts an implicit global and rejects other receivers before string conversion', () => {
    const { window } = prepared();
    const realm = getRelevantRealm(window);
    let conversions = 0;
    for (const name of ['atob', 'btoa'] as const) {
      const method = window[name];
      const input = name === 'atob' ? 'Zg==' : 'f';
      const expected = name === 'atob' ? 'f' : 'Zg==';
      expect(Reflect.apply(method, undefined, [input])).toBe(expected);
      expect(Reflect.apply(method, null, [input])).toBe(expected);
      expect(() => { Reflect.apply(method, {}, [{ toString() { conversions++; return input; } }]); })
        .toThrow(realm.TypeError);
    }
    expect(conversions).toBe(0);
  });
});

describe('Base64 exception realms', () => {
  const prepared = useFixture(async () => {
    const first = new Browlet({ route: () => '' });
    const second = new Browlet({ route: () => '' });
    await Promise.all([first.navigate('https://base64.test/'), second.navigate('https://base64.test/')]);
    return { first, second };
  });

  it('allocates algorithm errors in the borrowed method realm', () => {
    const { first, second } = prepared();
    for (const name of ['atob', 'btoa'] as const) {
      const method = first.window[name];
      const input = name === 'atob' ? '!' : '\u0100';
      let failure: unknown;
      try { Reflect.apply(method, second.window, [input]); }
      catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(first.window.DOMException);
      expect(failure).not.toBeInstanceOf(second.window.DOMException);
      expect(failure).toMatchObject({ name: 'InvalidCharacterError', code: 5 });
    }
  });
});
