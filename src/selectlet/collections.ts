import { mergeSortedUnique, mergeSortedUniqueLists } from '../infra/collections';

export type ElementCollection = {
  length: number;
  item?: (index: number) => Element | null;
  [index: number]: Element | undefined;
};

export function concatCollection(list: Element[], nodes: ElementCollection): void {
  const length = nodes.length;
  if (length === 0) return;

  if (nodes[0]) {
    for (let i = 0, j = list.length; i < length; ++i) {
      const node = nodes[i];
      if (!node) throw new Error(`Indexed collection returned empty item at ${i}`);
      list[j++] = node;
    }
    return;
  }

  const item = nodes.item;
  if (typeof item !== 'function') {
    throw new Error('Collection is neither indexed nor item()-addressable');
  }

  for (let i = 0, j = list.length; i < length; ++i) {
    const node = item.call(nodes, i);
    if (!node) throw new Error(`item() collection returned empty item at ${i}`);
    list[j++] = node;
  }
}

export function collectionToArray(nodes: ElementCollection): Element[] {
  const length = nodes.length;
  const list = new Array<Element>(length);
  if (length === 0) return list;

  if (nodes[0]) {
    for (let i = 0; i < length; ++i) {
      const node = nodes[i]!;
      list[i] = node;
    }
    return list;
  }

  const item = nodes.item;
  if (typeof item !== 'function') {
    throw new Error('Collection is neither indexed nor item()-addressable');
  }

  for (let i = 0; i < length; ++i) {
    const node = item.call(nodes, i);
    if (!node) throw new Error(`item() collection returned empty item at ${i}`);
    list[i] = node;
  }

  return list;
}

export function htmlCollectionSource(
  collection: ElementCollection & Iterable<Element>, copy: boolean,
  toArray?: (collection: ElementCollection & Iterable<Element>) => readonly Element[] | null,
): Iterable<Element> {
  const array = toArray?.(collection);
  if (array) return array;

  return copy
    ? collectionToArray(collection)
    : collection;
}

const DOCUMENT_POSITION_FOLLOWING = 4;

export function precedesByDocPosition(a: Element, b: Element): boolean {
  return !!(a.compareDocumentPosition(b) & DOCUMENT_POSITION_FOLLOWING);
}

/**
 * Merges document-ordered, internally-unique element lists.
 */
export function mergeDocumentOrder(a: Element[], b: Element[]): Element[] {
  return mergeSortedUnique(a, b, precedesByDocPosition);
}

/**
 * Merges document-ordered, internally-unique element lists.
 */
export function mergeDocumentOrderLists(lists: Element[][]): Element[] {
  return mergeSortedUniqueLists(lists, precedesByDocPosition);
}
