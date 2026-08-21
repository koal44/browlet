import { describe, expect, it } from 'vitest';

import { urlConstructors } from './contract';

/*
 * These are behaviorally distinct URLSearchParams cases from the URL WPT
 * corpus carried by jsdom and Firefox's independently authored regressions.
 */
describe('URLSearchParams reference implementation cases', () => {
  it('preserves malformed percent escapes as literal data', () => {
    const { URLSearchParams } = urlConstructors();

    for (const [input, value, serialization] of [
      ['b=%2sf%2a', '%2sf*', 'b=%252sf*'],
      ['b=%2%2af%2a', '%2*f*', 'b=%252*f*'],
      ['b=%%2a', '%*', 'b=%25*'],
    ] as const) {
      const params = new URLSearchParams(input);

      expect(params.get('b')).toBe(value);
      expect(params.toString()).toBe(serialization);
    }
  });

  it('copies another URLSearchParams list independently', () => {
    const { URLSearchParams } = urlConstructors();
    const source = new URLSearchParams('a=1');
    const copy = new URLSearchParams(source);

    source.append('b', '2');
    copy.append('c', '3');

    expect(source.toString()).toBe('a=1&b=2');
    expect(copy.toString()).toBe('a=1&c=3');
  });

  it('constructs sequences through their iterator protocol', () => {
    const { URLSearchParams } = urlConstructors();
    const input = {
      *[Symbol.iterator]() {
        yield ['a', '1'];
        yield ['b', '2'];
      },
    };

    const params = new URLSearchParams(input);

    expect(params.toString()).toBe('a=1&b=2');
  });

  it('converts record values to USVStrings', () => {
    const { URLSearchParams } = urlConstructors();
    const params = new URLSearchParams({
      boolean: true,
      null: null,
      number: 42,
    } as unknown as Record<string, string>);

    expect(params.toString()).toBe('boolean=true&null=null&number=42');
  });

  it('collapses record keys that become the same USVString', () => {
    const { URLSearchParams } = urlConstructors();
    const leading = new URLSearchParams({
      '\uD835x': '1',
      xx: '2',
      '\uD83Dx': '3',
    });
    const trailing = new URLSearchParams({
      'x\uDC53': '1',
      'x\uDC5C': '2',
      'x\uDC65': '3',
    });

    expect([...leading]).toEqual([['�x', '3'], ['xx', '2']]);
    expect([...trailing]).toEqual([['x�', '3']]);
  });

  it('treats an undefined optional value as omitted', () => {
    const { URLSearchParams } = urlConstructors();
    const params = new URLSearchParams('a=1&a=2&b=3');

    expect(params.has('a', undefined)).toBe(true);
    params.delete('a', undefined);

    expect(params.toString()).toBe('b=3');
  });

  it('removes a bare query marker after list mutation', () => {
    const { URL } = urlConstructors();
    const populated = new URL('https://example.com/?a=1');
    const empty = new URL('https://example.com/?');

    populated.searchParams.delete('a');
    empty.searchParams.delete('missing');

    expect(populated.href).toBe('https://example.com/');
    expect(empty.href).toBe('https://example.com/');
  });

  it('iterates the live list while it is mutated', () => {
    const { URLSearchParams } = urlConstructors();
    const params = new URLSearchParams('a=1&b=2&c=3');
    const visited: [string, string][] = [];

    params.forEach((value, name) => {
      visited.push([name, value]);
      if (name === 'a') params.delete('b');
    });

    expect(visited).toEqual([['a', '1'], ['c', '3']]);
  });

  it('sorts by UTF-16 code units without normalizing strings', () => {
    const { URLSearchParams } = urlConstructors();
    const params = new URLSearchParams();

    params.append('é', 'precomposed');
    params.append('e�', 'replacement');
    params.append('é', 'decomposed');
    params.append('ﬃ', 'ligature');
    params.append('🌈', 'rainbow');
    params.sort();

    expect([...params.keys()]).toEqual(['é', 'e�', 'é', '🌈', 'ﬃ']);
  });

  it('replaces malformed UTF-8 decoded from form data', () => {
    const { URLSearchParams } = urlConstructors();

    expect(new URLSearchParams('%e2').toString()).toBe('%EF%BF%BD=');
    expect(new URLSearchParams('a%e2b').toString()).toBe('a%EF%BF%BDb=');
  });

  it('does not normalize newlines before form serialization', () => {
    const { URLSearchParams } = urlConstructors();
    const params = new URLSearchParams();

    params.append('a\nb', 'c\rd');
    params.append('e\n\rf', 'g\r\nh');

    expect(params.toString()).toBe('a%0Ab=c%0Dd&e%0A%0Df=g%0D%0Ah');
  });

  it('rewrites a connected URL with form percent-encoding', () => {
    const { URL } = urlConstructors();
    const url = new URL('https://example.com/?a=b,c');

    expect(url.href).toBe('https://example.com/?a=b,c');
    expect(url.searchParams.toString()).toBe('a=b%2Cc');

    url.searchParams.append('x', 'y');

    expect(url.href).toBe('https://example.com/?a=b%2Cc&x=y');
  });
});
