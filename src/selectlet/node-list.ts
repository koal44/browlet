export type IndexedNodeList = NodeListOf<Element> & { length: number; [index: number]: Element; };

// Create a NodeList-like object from an element array.
let emptyNodeList: NodeListOf<ChildNode> | undefined;
export function toNodeList(nodeArray: Element[], doc: Document): IndexedNodeList {
  emptyNodeList ??= doc.createDocumentFragment().childNodes;

  const nodeList = Object.create(emptyNodeList, {
    length: {
      value: nodeArray.length,
      enumerable: false,
    },
    item: {
      value: function(this: IndexedNodeList, index: number) {
        return this[index] ?? null;
      },
      enumerable: false,
    },
  }) as IndexedNodeList;

  nodeArray.forEach(function(node, index) { nodeList[index] = node; });
  return nodeList;
}
