import {
  defineInterfaceMixin, idlType, nullable, roAttr, reference, xattr,
} from '../../../web-idl/index';
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
  readonly #children: HTMLCollectionImpl<ElementImpl>;
  readonly #node: NodeImpl;

  constructor(node: NodeImpl) {
    this.#node = node;
    this.#children = new HTMLCollectionImpl(() => collectChildren(node));
  }

  get children(): HTMLCollectionImpl<ElementImpl> {
    this.#children.refresh();
    return this.#children;
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
    if (isElement(child)) children.push(child);
  }
  return children;
}
