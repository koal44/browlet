/** A fixed query result with NodeList-style indexing and iteration. */
export interface IndexedNodeList<E extends object = object> extends Iterable<E> {
  length: number;
  [index: number]: E;
  item(index: number): E | null;
  entries(): ArrayIterator<[number, E]>;
  keys(): ArrayIterator<number>;
  values(): ArrayIterator<E>;
  forEach(callback: (value: E, index: number, list: IndexedNodeList<E>) => void, thisArg?: unknown): void;
}

export function toNodeList<E extends object>(elements: E[]): IndexedNodeList<E> {
  const list: IndexedNodeList<E> = {
    length: elements.length,
    item: (index) => elements[index] ?? null,
    entries: () => elements.entries(),
    keys: () => elements.keys(),
    values: () => elements.values(),
    [Symbol.iterator]: () => elements.values(),
    forEach(callback, thisArg) {
      elements.forEach((value, index) => callback.call(thisArg, value, index, list));
    },
  };
  for (let index = 0; index < elements.length; index++) list[index] = elements[index]!;
  return list;
}
