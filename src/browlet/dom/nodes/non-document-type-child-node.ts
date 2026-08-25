import {
  defineInterfaceMixin, nullable, readonlyAttr, reference,
} from '../../../web-idl/declaration/index';
import { isElement, type NodeImpl } from './node';
import type { ElementImpl } from './element';

/*
 * interface mixin NonDocumentTypeChildNode {
 *   readonly attribute Element? previousElementSibling;
 *   readonly attribute Element? nextElementSibling;
 * };
 */
export class NonDocumentTypeChildNodeMixin {
  readonly #node: NodeImpl;

  constructor(node: NodeImpl) {
    this.#node = node;
  }

  get previousElementSibling(): ElementImpl | null {
    for (
      let sibling = this.#node.previousSibling;
      sibling;
      sibling = sibling.previousSibling
    ) {
      if (isElement(sibling)) return sibling;
    }

    return null;
  }

  get nextElementSibling(): ElementImpl | null {
    for (
      let sibling = this.#node.nextSibling;
      sibling;
      sibling = sibling.nextSibling
    ) {
      if (isElement(sibling)) return sibling;
    }

    return null;
  }
}

// -- Web IDL ------------------------------------------------------------

export const nonDocumentTypeChildNodeIDL = defineInterfaceMixin({
  members: [
    readonlyAttr(
      'previousElementSibling',
      nullable(reference('Element')),
    ),
    readonlyAttr('nextElementSibling', nullable(reference('Element'))),
  ],
  name: 'NonDocumentTypeChildNode',
});
