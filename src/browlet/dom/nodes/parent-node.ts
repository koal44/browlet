import {
  defineInterfaceMixin, idlType, nullable, roAttr, reference, xattr,
} from '../../../web-idl/index';
import { HTMLCollectionImpl } from './collections';
import type { NodeImpl } from './node';
import type { ElementImpl } from './element';

/** Live child collections and element-child navigation for parent nodes. */
// https://dom.spec.whatwg.org/#interface-parentnode
export class ParentNodeMixin {
  /** Stable collection object refreshed from the node's children. */
  #children: HTMLCollectionImpl<ElementImpl>;
  /** Parent whose children the mixin exposes. */
  #node: NodeImpl;

  constructor(node: NodeImpl) {
    this.#node = node;
    this.#children = new HTMLCollectionImpl(() => collectChildren(node));
  }

  /** Live collection of immediate element children in tree order. */
  // https://dom.spec.whatwg.org/#dom-parentnode-children
  get children(): HTMLCollectionImpl<ElementImpl> {
    this.#children.refresh();
    return this.#children;
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
    roAttr(
      'children',
      reference('HTMLCollection'),
      xattr('SameObject'),
    ),
    roAttr('firstElementChild', nullable(reference('Element'))),
    roAttr('lastElementChild', nullable(reference('Element'))),
    roAttr('childElementCount', idlType.unsignedLong),
  ],
});

function collectChildren(node: NodeImpl): ElementImpl[] {
  const children: ElementImpl[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.isElement()) children.push(child);
  }
  return children;
}
