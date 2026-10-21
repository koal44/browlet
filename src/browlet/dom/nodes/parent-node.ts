import {
  arg, defineInterfaceMixin, idlType, nullable, op, roAttr, reference, union, xattr,
} from '../../../web-idl/core/index';

import { HTMLCollectionImpl, NodeListImpl } from './collections';
import type { InsertionParent, NodeImpl } from './node';
import type { ElementImpl } from './element';

/** Live child collections and element-child navigation for parent nodes. */
// https://dom.spec.whatwg.org/#interface-parentnode
export class ParentNodeMixin {
  /** Stable collection object refreshed from the node's children. */
  #children: HTMLCollectionImpl | undefined;
  /** Parent whose children the mixin exposes. */
  #node: InsertionParent;

  constructor(node: InsertionParent) {
    this.#node = node;
  }

  /** Live collection of immediate element children in tree order. */
  // https://dom.spec.whatwg.org/#dom-parentnode-children
  get children(): HTMLCollectionImpl {
    return this.#children ??= HTMLCollectionImpl.fromRoot(this.#node, () => true, true);
  }

  // https://dom.spec.whatwg.org/#dom-parentnode-firstelementchild
  get firstElementChild(): ElementImpl | null {
    for (
      let child = this.#node.firstChild;
      child;
      child = child.nextSibling
    ) {
      if (child.isElement()) return child;
    }

    return null;
  }

  // https://dom.spec.whatwg.org/#dom-parentnode-lastelementchild
  get lastElementChild(): ElementImpl | null {
    for (
      let child = this.#node.lastChild;
      child;
      child = child.previousSibling
    ) {
      if (child.isElement()) return child;
    }

    return null;
  }

  // https://dom.spec.whatwg.org/#dom-parentnode-childelementcount
  get childElementCount(): number {
    let count = 0;

    for (
      let child = this.firstElementChild;
      child;
      child = child.nextElementSibling
    ) {
      count++;
    }

    return count;
  }

  /** Convert arguments before selecting the current first child for insertion. */
  // https://dom.spec.whatwg.org/#dom-parentnode-prepend
  prepend(...nodes: (NodeImpl | string)[]): void {
    const node = this.#node.nodeDocument.convertNodesIntoNode(nodes);
    this.#node.insertBefore(node, this.#node.firstChild);
  }

  // https://dom.spec.whatwg.org/#dom-parentnode-append
  append(...nodes: (NodeImpl | string)[]): void {
    this.#node.appendChild(this.#node.nodeDocument.convertNodesIntoNode(nodes));
  }

  /** Replace children through the shared mutation path after validating the new tree. */
  // https://dom.spec.whatwg.org/#dom-parentnode-replacechildren
  replaceChildren(...nodes: (NodeImpl | string)[]): void {
    const node = this.#node.nodeDocument.convertNodesIntoNode(nodes);
    const children: NodeImpl[] = [];
    for (let child = this.#node.firstChild; child; child = child.nextSibling) children.push(child);
    this.#node.ensurePreInsertValidity(node, null, children);
    this.#node.replaceAll(node);
  }

  /** Move an existing node without running removal and insertion lifecycle hooks. */
  // https://dom.spec.whatwg.org/#dom-parentnode-movebefore
  moveBefore(node: NodeImpl, child: NodeImpl | null): void {
    this.#node.move(node, child === node ? node.nextSibling : child);
  }

  /** Match descendants with this node as the selector scoping root. */
  // https://dom.spec.whatwg.org/#dom-parentnode-queryselector
  querySelector(selectors: string): ElementImpl | null {
    return this.#node.nodeDocument.getSelectorEngine().first(selectors, this.#node);
  }

  /** Snapshot matches in tree order; later mutations do not change this list. */
  // https://dom.spec.whatwg.org/#dom-parentnode-queryselectorall
  querySelectorAll(selectors: string): NodeListImpl {
    return new NodeListImpl(Array.from(
      this.#node.nodeDocument.getSelectorEngine().select(selectors, this.#node),
    ));
  }
}

/*
 * interface mixin ParentNode {
 *   [SameObject] readonly attribute HTMLCollection children;
 *   readonly attribute Element? firstElementChild;
 *   readonly attribute Element? lastElementChild;
 *   readonly attribute unsigned long childElementCount;
 *
 *   [CEReactions, Unscopable] undefined prepend((Node or DOMString)... nodes);
 *   [CEReactions, Unscopable] undefined append((Node or DOMString)... nodes);
 *   [CEReactions, Unscopable] undefined replaceChildren((Node or DOMString)... nodes);
 *
 *   [CEReactions] undefined moveBefore(Node node, Node? child);
 *
 *   Element? querySelector(DOMString selectors);
 *   [NewObject] NodeList querySelectorAll(DOMString selectors);
 * };
 */
export const parentNodeIDL = defineInterfaceMixin({
  name: 'ParentNode',
  members: [
    roAttr('children', reference('HTMLCollection'),
      xattr('SameObject'),
    ),
    roAttr('firstElementChild', nullable(reference('Element'))),
    roAttr('lastElementChild', nullable(reference('Element'))),
    roAttr('childElementCount', idlType.unsignedLong),
    op('prepend', idlType.undefined,
      [arg('nodes', union(reference('Node'), idlType.DOMString), { variadic: true })],
      xattr('CEReactions', 'Unscopable'),
    ),
    op('append', idlType.undefined,
      [arg('nodes', union(reference('Node'), idlType.DOMString), { variadic: true })],
      xattr('CEReactions', 'Unscopable'),
    ),
    op('replaceChildren', idlType.undefined,
      [arg('nodes', union(reference('Node'), idlType.DOMString), { variadic: true })],
      xattr('CEReactions', 'Unscopable'),
    ),
    op('moveBefore', idlType.undefined,
      [arg('node', reference('Node')), arg('child', nullable(reference('Node')))],
      xattr('CEReactions'),
    ),
    op('querySelector', nullable(reference('Element')), [arg('selectors', idlType.DOMString)]),
    op('querySelectorAll', reference('NodeList'),
      [arg('selectors', idlType.DOMString)],
      xattr('NewObject'),
    ),
  ],
});
