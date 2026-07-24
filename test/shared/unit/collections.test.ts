import { describe, expect, it } from 'vitest';
import { mergeSortedUnique, mergeSortedUniqueLists } from '../../../src/shared/collections';

const order = new Map([...`abcdefghi`].map((c, i) => [c, i]));

function precedes(a: string, b: string): boolean {
  return order.get(a)! < order.get(b)!;
}

describe('mergeSortedUnique', () => {
  it('merges two sorted unique lists', () => {
    expect(mergeSortedUnique(['a', 'd', 'g'], ['b', 'c', 'h'], precedes))
      .toEqual(['a', 'b', 'c', 'd', 'g', 'h']);
  });

  it('removes cross-list duplicates', () => {
    expect(mergeSortedUnique(['a', 'c', 'e'], ['b', 'c', 'f'], precedes))
      .toEqual(['a', 'b', 'c', 'e', 'f']);
  });

  it('handles empty sides', () => {
    expect(mergeSortedUnique([], ['a', 'b'], precedes)).toEqual(['a', 'b']);
    expect(mergeSortedUnique(['a', 'b'], [], precedes)).toEqual(['a', 'b']);
  });
});

describe('mergeSortedUniqueLists', () => {
  it('merges many sorted unique lists', () => {
    expect(mergeSortedUniqueLists([
      ['a', 'e'],
      ['b', 'e', 'h'],
      ['c', 'd', 'h'],
    ], precedes)).toEqual(['a', 'b', 'c', 'd', 'e', 'h']);
  });

  it('handles no lists', () => {
    expect(mergeSortedUniqueLists([], precedes)).toEqual([]);
  });

  it('returns the single list', () => {
    const list = ['a', 'b'];
    const out = mergeSortedUniqueLists([list], precedes);

    expect(out).toEqual(['a', 'b']);
    expect(out).toBe(list);
  });
});
