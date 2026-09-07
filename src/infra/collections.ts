export function iterableToArray<T>(items: Iterable<T>): T[] {
  if (Array.isArray(items)) return items as T[];

  const list: T[] = [];
  let i = 0;

  for (const item of items) {
    list[i++] = item;
  }

  return list;
}

export function mergeSortedUniqueLists<T>(lists: T[][], precedes: Precedes<T>): T[] {
  if (lists.length === 0) return [];
  if (lists.length === 1) return lists[0]!;

  const first = lists[0]!;
  let out = first.slice();

  for (let i = 1; i < lists.length; ++i) {
    const list = lists[i]!;
    if (list.length === 0) continue;
    if (out.length === 0) {
      out = list.slice();
      continue;
    }
    out = mergeSortedUnique(out, list, precedes);
  }

  return out;
}

export function mergeSortedUnique<T>(a: T[], b: T[], precedes: Precedes<T>): T[] {
  const nodes: T[] = [];
  let i = 0, j = 0, k = 0;

  while (i < a.length && j < b.length) {
    const x = a[i]!;
    const y = b[j]!;

    if (x === y) {
      nodes[k++] = x;
      ++i;
      ++j;
    } else if (precedes(x, y)) {
      nodes[k++] = x;
      ++i;
    } else {
      nodes[k++] = y;
      ++j;
    }
  }

  while (i < a.length) {
    const value = a[i]!;
    nodes[k++] = value;
    i++;
  }

  while (j < b.length) {
    const value = b[j]!;
    nodes[k++] = value;
    j++;
  }

  return nodes;
}

export type Precedes<T> = (a: T, b: T) => boolean;
