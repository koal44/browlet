import {
  defineInterfaceMixin, idlType, nullable, roAttr, reference,
} from '../../../web-idl/declaration/index';
import { HTMLCollectionImpl } from './collections';
import { isElement, type NodeImpl } from './node';
import type { ElementImpl } from './element';

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
export class ParentNodeMixin {
  readonly #node: NodeImpl;

  constructor(node: NodeImpl) {
    this.#node = node;
  }

  get children(): HTMLCollectionOf<Element> {
    const children = new HTMLCollectionImpl();

    for (
      let child = this.firstElementChild;
      child;
      child = child.nextElementSibling
    ) {
      children.push(child);
    }

    return children;
  }

  get firstElementChild(): ElementImpl | null {
    for (
      let child = this.#node.firstChild;
      child;
      child = child.nextSibling
    ) {
      if (isElement(child)) return child;
    }

    return null;
  }

  get lastElementChild(): ElementImpl | null {
    for (
      let child = this.#node.lastChild;
      child;
      child = child.previousSibling
    ) {
      if (isElement(child)) return child;
    }

    return null;
  }

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

// -- Web IDL ------------------------------------------------------------

export const parentNodeIDL = defineInterfaceMixin({
  name: 'ParentNode',
  members: [
    roAttr('children', idlType.object),
    roAttr('firstElementChild', nullable(reference('Element'))),
    roAttr('lastElementChild', nullable(reference('Element'))),
    roAttr('childElementCount', idlType.unsignedLong),
  ],
});
