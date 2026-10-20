import {
  arg, defineInterfaceMixin, idlType, op, reference, union, xattr,
} from '../../../web-idl/core/index';

import type { NodeImpl } from './node';

/** Tree mutations shared by nodes that can occur as children. */
// https://dom.spec.whatwg.org/#interface-childnode
export class ChildNodeMixin {
  /** Node on which the mixin's mutations operate. */
  #node: NodeImpl;

  constructor(node: NodeImpl) {
    this.#node = node;
  }

  /** Keep a viable sibling anchor while conversion may move any supplied nodes. */
  // https://dom.spec.whatwg.org/#dom-childnode-before
  before(...nodes: (NodeImpl | string)[]): void {
    const parent = this.#node.parentNode;
    if (parent === null) return;
    let previous = this.#node.previousSibling;
    while (previous && nodes.includes(previous)) previous = previous.previousSibling;
    const node = this.#node.nodeDocument.convertNodesIntoNode(nodes);
    parent.insertBefore(node, previous === null ? parent.firstChild : previous.nextSibling);
  }

  // https://dom.spec.whatwg.org/#dom-childnode-after
  after(...nodes: (NodeImpl | string)[]): void {
    const parent = this.#node.parentNode;
    if (parent === null) return;
    let next = this.#node.nextSibling;
    while (next && nodes.includes(next)) next = next.nextSibling;
    parent.insertBefore(this.#node.nodeDocument.convertNodesIntoNode(nodes), next);
  }

  /** Replace this node, or insert at its saved position if conversion already moved it. */
  // https://dom.spec.whatwg.org/#dom-childnode-replacewith
  replaceWith(...nodes: (NodeImpl | string)[]): void {
    const parent = this.#node.parentNode;
    if (parent === null) return;
    let next = this.#node.nextSibling;
    while (next && nodes.includes(next)) next = next.nextSibling;
    const node = this.#node.nodeDocument.convertNodesIntoNode(nodes);
    if (this.#node.parentNode === parent) parent.replaceChild(node, this.#node);
    else parent.insertBefore(node, next);
  }

  // https://dom.spec.whatwg.org/#dom-childnode-remove
  remove(): void {
    if (this.#node.parentNode !== null) this.#node.removeNode();
  }
}

/*
 * interface mixin ChildNode {
 *   [CEReactions, Unscopable] undefined before((Node or DOMString)... nodes);
 *   [CEReactions, Unscopable] undefined after((Node or DOMString)... nodes);
 *   [CEReactions, Unscopable] undefined replaceWith((Node or DOMString)... nodes);
 *   [CEReactions, Unscopable] undefined remove();
 * };
 */
export const childNodeIDL = defineInterfaceMixin({
  name: 'ChildNode',
  members: [
    op('before', idlType.undefined,
      [arg('nodes', union(reference('Node'), idlType.DOMString), { variadic: true })],
      xattr('CEReactions', 'Unscopable'),
    ),
    op('after', idlType.undefined,
      [arg('nodes', union(reference('Node'), idlType.DOMString), { variadic: true })],
      xattr('CEReactions', 'Unscopable'),
    ),
    op('replaceWith', idlType.undefined,
      [arg('nodes', union(reference('Node'), idlType.DOMString), { variadic: true })],
      xattr('CEReactions', 'Unscopable'),
    ),
    op('remove', idlType.undefined, [], xattr('CEReactions', 'Unscopable')),
  ],
});
