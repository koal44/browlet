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

export function sortUniqueByDocPosition(nodes: Element[]): void {
  let hasDupes = false;

  nodes.sort((a, b) => {
    if (a === b) {
      hasDupes = true;
      return 0;
    }
    // Node.DOCUMENT_POSITION_FOLLOWING = 4
    return a.compareDocumentPosition(b) & 4 ? -1 : 1;
  });

  if (!hasDupes) return;

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

export function mergeDocumentOrder(a: Element[], b: Element[]): Element[] {
  const nodes: Element[] = [];
  let i = 0, j = 0, k = 0;

  while (i < a.length && j < b.length) {
    const x = a[i];
    const y = b[j];

    if (x === y) {
      nodes[k++] = x;
      ++i;
      ++j;
    } else if (x.compareDocumentPosition(y) & 4) {
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
