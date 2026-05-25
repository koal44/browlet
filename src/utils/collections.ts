import type { IndexedNodeList } from "../selectlet";

export function concatCollection(list: Element[], nodes: HTMLCollectionOf<Element>): void {
  for (let i = 0, j = list.length, l = nodes.length; i < l; ++i) {
    list[j++] = nodes[i];
  }
}

export function collectionToArray(nodes: HTMLCollectionOf<Element>): Element[] {
  const list: Element[] = [];
  for (let i = 0, l = nodes.length; i < l; ++i) {
    list[i] = nodes[i];
  }
  return list;
}

// create a NodeList-like object from an element array
let emptyNL: NodeListOf<ChildNode> | undefined;
export function toNodeList(nodeArray: Element[], doc: Document): IndexedNodeList {
  // create a DocumentFragment
  emptyNL ??= doc.createDocumentFragment().childNodes;

  // base an object on emptyNL
  const fakeNL = Object.create(emptyNL, {
    length: {
      value: nodeArray.length,
      enumerable: false
    },
    item: {
      value: function(i: string | number) {
        return this[+i || 0];
      },
      enumerable: false
    }
  });

  // copy the array elements
  nodeArray.forEach(function(v, i) { fakeNL[i] = v; });

  // return an object pretending to be a NodeList.
  return fakeNL;
}



const DOCUMENT_POSITION_FOLLOWING = 4;
export type Precedes<T> = (a: T, b: T) => boolean;
export function precedesByDocPosition(a: Element, b: Element): boolean {
  return !!(a.compareDocumentPosition(b) & DOCUMENT_POSITION_FOLLOWING);
}

/**
 * Sorts arbitrary elements in document order and removes duplicates.
 */
export function sortUniqueByDocPosition(nodes: Element[]): void {
  if (nodes.length < 2) return;

  nodes.sort((a, b) => {
    if (a === b) return 0;
    return precedesByDocPosition(a, b) ? -1 : 1;
  });

  let j = 1;
  let last = nodes[0];

  for (let i = 1, l = nodes.length; i < l; ++i) {
    const cur = nodes[i];
    if (cur !== last) {
      nodes[j++] = cur;
      last = cur;
    }
  }

  nodes.length = j;
}

/**
 * Merges document-ordered, internally-unique element lists.
 */
export function mergeDocumentOrder( a: Element[], b: Element[]): Element[] {
  return mergeSortedUnique(a, b, precedesByDocPosition);
}

export function mergeSortedUnique<T>(a: T[], b: T[], precedes: Precedes<T>): T[] {
  const nodes: T[] = [];
  let i = 0, j = 0, k = 0;

  while (i < a.length && j < b.length) {
    const x = a[i];
    const y = b[j];

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

  while (i < a.length) nodes[k++] = a[i++];
  while (j < b.length) nodes[k++] = b[j++];

  return nodes;
}

/**
 * Merges document-ordered, internally-unique element lists.
 */
export function mergeDocumentOrderLists(lists: Element[][]): Element[] {
  return mergeSortedUniqueLists(lists, precedesByDocPosition);
}

export function mergeSortedUniqueLists<T>(lists: T[][], precedes: Precedes<T>): T[] {
  if (lists.length === 0) return [];
  if (lists.length === 1) return lists[0];

  let out = lists[0].slice();

  for (let i = 1; i < lists.length; ++i) {
    const list = lists[i];
    if (list.length === 0) continue;
    if (out.length === 0) {
      out = list.slice();
      continue;
    }
    out = mergeSortedUnique(out, list, precedes);
  }

  return out;
}
