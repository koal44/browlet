import { describe, expect, it, vi } from 'vitest';

import { getBindingContext, getRelevantRealm } from '../../src/browlet/bindings';
import { Browlet } from '../../src/browlet/browlet';
import { HeadersImpl } from '../../src/fetch/headers';

/* eslint-disable @typescript-eslint/unbound-method -- These tests deliberately borrow methods and supply receivers. */

describe('Fetch Headers projection', () => {
  it('constructs empty, record, and sequence headers with independent lists', () => {
    const window = createWindow();
    expect([...new window.Headers()]).toEqual([]);
    expect([...new window.Headers(undefined)]).toEqual([]);
    const headers = new window.Headers({ 'X-Name': ' \t value\r\n', Empty: '' });
    expect([...headers]).toEqual([['empty', ''], ['x-name', 'value']]);

    const copy = new window.Headers(headers);
    headers.set('X-Name', 'changed');
    expect(copy.get('x-name')).toBe('value');
    const pairs: [string, string][] = [['B', '1'], ['b', '2'], ['A', '3']];
    const fromPairs = new window.Headers(pairs);
    pairs[0]![1] = 'changed';
    expect([...fromPairs]).toEqual([['a', '3'], ['b', '1, 2']]);
  });

  it('keeps implementation fields off the platform object', () => {
    const window = createWindow();
    const headers = new window.Headers({ X: 'value' });
    const context = getBindingContext(getRelevantRealm(window));
    const implementation = context.unwrap(headers, HeadersImpl)!;
    expect(implementation).toBeInstanceOf(HeadersImpl);
    expect(implementation).not.toBe(headers);
    expect(Object.getPrototypeOf(headers)).toBe(window.Headers.prototype);
    expect(Reflect.ownKeys(headers)).toEqual([]);
    expect(Reflect.has(headers, 'headerList')).toBe(false);
    expect(Reflect.has(headers, 'guard')).toBe(false);
    expect(Reflect.has(headers, 'fill')).toBe(false);
    expect(Object.prototype.toString.call(headers)).toBe('[object Headers]');
  });

  it('returns separate Set-Cookie entries and fresh realm-owned arrays', () => {
    const window = createWindow();
    const headers = new window.Headers([
      ['Set-Cookie', 'a=1; Expires=Wed, 09 Jun 2027 10:18:14 GMT'],
      ['set-cookie', 'b=2'], ['Z', 'last'],
    ]);
    const cookies = headers.getSetCookie();
    expect(cookies).toBeInstanceOf(window.Array);
    expect(cookies).not.toBeInstanceOf(Array);
    expect(cookies).toEqual(['a=1; Expires=Wed, 09 Jun 2027 10:18:14 GMT', 'b=2']);
    expect([...headers.keys()]).toEqual(['set-cookie', 'set-cookie', 'z']);
    cookies[0] = 'not retained';
    expect(headers.getSetCookie()).not.toEqual(cookies);
    expect(headers.get('set-cookie')).toBe('a=1; Expires=Wed, 09 Jun 2027 10:18:14 GMT, b=2');
  });

  it('recomputes sorted entries between iterator steps and forEach callbacks', () => {
    const window = createWindow();
    const headers = new window.Headers([['B', '2'], ['D', '4']]);
    const iterator = headers.entries();
    expect(headers[Symbol.iterator]).toBe(headers.entries);
    expect(iterator.next().value).toEqual(['b', '2']);
    headers.append('A', '1');
    expect(iterator.next().value).toEqual(['b', '2']);
    headers.delete('A');
    headers.set('E', '5');
    expect(iterator.next().value).toEqual(['e', '5']);
    expect(iterator.next()).toEqual({ done: true, value: undefined });

    const visited: [string, string][] = [];
    const receiver = {};
    headers.forEach(function(this: unknown, value, name, source) {
      expect(this).toBe(receiver);
      expect(source).toBe(headers);
      visited.push([name, value]);
      if (name === 'b') {
        source.delete('d');
        source.set('c', '3');
      }
    }, receiver);
    expect(visited).toEqual([['b', '2'], ['c', '3'], ['e', '5']]);
    expect([...headers.values()]).toEqual(['2', '3', '5']);
  });

  it('converts byte strings before validation and preserves every permitted byte', () => {
    const window = createWindow();
    const headers = new window.Headers();
    Reflect.apply(headers.append, headers, [123, null]);
    Reflect.apply(headers.append, headers, ['Missing', undefined]);
    expect(headers.get('123')).toBe('null');
    expect(headers.get('missing')).toBe('undefined');
    headers.set('Bytes', '\u0080\u00ff');
    expect(headers.get('bytes')).toBe('\u0080\u00ff');
    for (const value of ['bad\0value', 'bad\nvalue', 'bad\rvalue', '\u0100', '\ud800']) {
      expect(() => headers.append('X', value)).toThrow(window.TypeError);
    }
    for (const name of ['', 'bad name', 'bad:name', '\u00e9']) {
      expect(() => headers.get(name)).toThrow(window.TypeError);
      expect(() => headers.has(name)).toThrow(window.TypeError);
      expect(() => headers.delete(name)).toThrow(window.TypeError);
    }
    expect(() => { Reflect.apply(headers.append, headers, ['X']); }).toThrow(window.TypeError);
    expect(() => { Reflect.apply(window.Headers, undefined, []); }).toThrow(window.TypeError);
  });

  it('converts the whole initializer before checking pair lengths', () => {
    const window = createWindow();
    const convertLaterValue = vi.fn(() => 'later');
    const init = [['invalid'], ['valid', { toString: convertLaterValue }]];
    expect(() => { Reflect.construct(window.Headers, [init]); }).toThrow(window.TypeError);
    expect(convertLaterValue).toHaveBeenCalledOnce();
    for (const malformed of [null, 42, 'abc', { [Symbol.iterator]: 42 }, [['a', 'b', 'c']]]) {
      expect(() => { Reflect.construct(window.Headers, [malformed]); }).toThrow(window.TypeError);
    }
  });

  it('reads enumerable own record keys, including __proto__, and rejects symbol keys', () => {
    const window = createWindow();
    const inherited = { Inherited: 'ignored' };
    const ownValue = vi.fn(() => 'own');
    const init = Object.create(inherited, {
      Visible: { enumerable: true, get: ownValue },
      Hidden: { value: 'ignored' },
      ['__proto__']: { enumerable: true, value: 'literal' },
      [Symbol('hidden')]: { value: '\u0100' },
    }) as Record<string, string>;
    const headers = new window.Headers(init);
    expect([...headers]).toEqual([['__proto__', 'literal'], ['visible', 'own']]);
    expect(ownValue).toHaveBeenCalledOnce();
    expect(() => new window.Headers({ [Symbol('enumerable')]: 'value' })).toThrow(window.TypeError);
  });

  it('propagates initializer and callback exceptions unchanged', () => {
    const window = createWindow();
    const failure = new Error('author failure');
    expect(() => new window.Headers({ get X(): string { throw failure; } })).toThrow(failure);
    const headers = new window.Headers({ X: 'value' });
    expect(() => headers.forEach(() => { throw failure; })).toThrow(failure);
    expect(() => headers.forEach(null!)).toThrow(window.TypeError);
  });

  it('uses the borrowed method realm for errors, retaining the receiver', () => {
    const owner = createWindow();
    const other = createWindow();
    const headers = new owner.Headers({ 'Set-Cookie': 'a=1' });
    other.Headers.prototype.append.call(headers, 'X', 'value');
    expect(headers.get('X')).toBe('value');
    expect(() => other.Headers.prototype.set.call(headers, 'bad name', 'value')).toThrow(other.TypeError);
    expect(() => other.Headers.prototype.get.call({}, 'X')).toThrow(other.TypeError);
  });

  it('allocates iterator results in the invoked next method realm', () => {
    const owner = createWindow();
    const other = createWindow();
    const headers = new owner.Headers({ 'Set-Cookie': 'a=1' });
    const iterator = headers.entries();
    const otherNext = new other.Headers().entries().next;
    const result = otherNext.call(iterator);
    expect(Object.getPrototypeOf(result)).toBe(other.Object.prototype);
    expect(result.value).toBeInstanceOf(other.Array);
    expect(result.value).toEqual(['set-cookie', 'a=1']);
  });

  it('allocates a borrowed getSetCookie result in the receiver realm', () => {
    const owner = createWindow();
    const other = createWindow();
    const headers = new owner.Headers({ 'Set-Cookie': 'a=1' });
    const cookies = other.Headers.prototype.getSetCookie.call(headers);
    expect(cookies).toBeInstanceOf(owner.Array);
    expect(cookies).not.toBeInstanceOf(other.Array);
  });

  it('realizes immutable-guard failures through the actual binding', () => {
    const window = createWindow();
    const headers = new window.Headers({ X: 'value' });
    const context = getBindingContext(getRelevantRealm(window));
    context.unwrap(headers, HeadersImpl)!.guard = 'immutable';
    expect(() => headers.append('X', 'new')).toThrow(window.TypeError);
    expect(() => headers.set('X', 'new')).toThrow(window.TypeError);
    expect(() => headers.delete('X')).toThrow(window.TypeError);
    expect(headers.get('X')).toBe('value');
  });

  it('constructs author subclasses without calling overridden append methods', async () => {
    const browlet = new Browlet({ route: () => '' });
    const result = await browlet.evaluate(() => {
      class CustomHeaders extends Headers {
        override append(): void { throw new Error('Author override must not run during fill'); }
      }
      const headers = new CustomHeaders({ X: 'value' });
      return {
        subclass: headers instanceof CustomHeaders,
        headers: headers instanceof Headers,
        value: headers.get('X'),
        constructorLength: Headers.length,
      };
    });
    expect(result).toEqual({ subclass: true, headers: true, value: 'value', constructorLength: 0 });
  });
});

function createWindow(): Window & typeof globalThis {
  return new Browlet({ route: () => '' }).window as Window & typeof globalThis;
}
