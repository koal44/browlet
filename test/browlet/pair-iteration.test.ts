import { describe, expect, it } from 'vitest';

import { Browlet } from '../../src/browlet/browlet';

describe.each(['URLSearchParams', 'FormData'] as const)('%s pair iteration', (name) => {
  function createPairs() {
    const window = new Browlet({ route: () => '' }).window as Window & typeof globalThis;
    return new window[name]();
  }

  it('observes replacement, duplicate removal, deletion, and append at the current index', () => {
    const pairs = createPairs();
    pairs.append('a', '1');
    pairs.append('b', 'old');
    pairs.append('c', '3');
    pairs.append('b', 'duplicate');
    const iterator = pairs.entries();

    expect(iterator.next()).toEqual({ done: false, value: ['a', '1'] });
    pairs.set('b', 'new');
    expect(iterator.next()).toEqual({ done: false, value: ['b', 'new'] });
    pairs.delete('a');
    pairs.append('d', '4');
    expect(iterator.next()).toEqual({ done: false, value: ['d', '4'] });
    expect(iterator.next()).toEqual({ done: true, value: undefined });
  });

  it('consults the live list after returning done', () => {
    const pairs = createPairs();
    const iterator = pairs.entries();
    expect(iterator.next()).toEqual({ done: true, value: undefined });

    pairs.append('later', '1');

    expect(iterator.next()).toEqual({ done: false, value: ['later', '1'] });
    expect(iterator.next()).toEqual({ done: true, value: undefined });
  });

  it('rechecks the list after each forEach callback', () => {
    const pairs = createPairs();
    pairs.append('a', '1');
    pairs.append('b', '2');
    pairs.append('c', 'old');
    const visited: unknown[][] = [];
    const receiver = {};

    pairs.forEach(function(this: object, value, key, source) {
      expect(this).toBe(receiver);
      expect(source).toBe(pairs);
      visited.push([key, value]);
      if (key === 'a') {
        pairs.delete('a');
        pairs.set('c', 'new');
        pairs.append('d', '4');
      }
    }, receiver);

    expect(visited).toEqual([['a', '1'], ['c', 'new'], ['d', '4']]);
  });

  it('returns independent entry arrays and independent iterator positions', () => {
    const pairs = createPairs();
    pairs.append('a', '1');
    pairs.append('b', '2');
    const first = pairs.entries();
    const second = pairs.entries();
    const entry = first.next().value as [string, string];
    entry[0] = 'changed';
    entry[1] = 'changed';

    expect(pairs.get('a')).toBe('1');
    expect(second.next()).toEqual({ done: false, value: ['a', '1'] });
    expect(first.next()).toEqual({ done: false, value: ['b', '2'] });
  });

  it('accepts next borrowed from another realm and allocates its result there', () => {
    const first = new Browlet({ route: () => '' }).window as Window & typeof globalThis;
    const second = new Browlet({ route: () => '' }).window as Window & typeof globalThis;
    const pairs = new first[name]();
    pairs.append('a', '1');
    pairs.append('b', '2');

    const foreignIterator = second[name].prototype.entries.call(pairs);
    expect(foreignIterator.next()).toEqual({ done: false, value: ['a', '1'] });

    const iterator = pairs.entries();
    const result = foreignIterator.next.call(iterator);
    expect(result).toEqual({ done: false, value: ['a', '1'] });
    expect(Object.getPrototypeOf(result)).toBe(second.Object.prototype);
    expect(result.value).toBeInstanceOf(second.Array);
    expect(iterator.next()).toEqual({ done: false, value: ['b', '2'] });
  });
});

it('rejects a pair iterator belonging to a different interface', () => {
  const window = new Browlet({ route: () => '' }).window as Window & typeof globalThis;
  const params = new window.URLSearchParams().entries();
  const formData = new window.FormData().entries();

  expect(() => params.next.call(formData)).toThrow(window.TypeError);
});

it('retains a URLSearchParams iterator index across sorting and URL query replacement', () => {
  const window = new Browlet({ route: () => '' }).window as Window & typeof globalThis;
  const url = new window.URL('https://example.com/?c=3&a=1&b=2');
  const pairs = url.searchParams;
  const iterator = pairs.entries();

  expect(iterator.next()).toEqual({ done: false, value: ['c', '3'] });
  pairs.sort();
  expect(iterator.next()).toEqual({ done: false, value: ['b', '2'] });
  url.search = '?x=1&y=2&z=3';
  expect(iterator.next()).toEqual({ done: false, value: ['z', '3'] });
  expect(iterator.next()).toEqual({ done: true, value: undefined });
});
