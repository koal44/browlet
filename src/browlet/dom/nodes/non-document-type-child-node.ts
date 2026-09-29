import {
  defineInterfaceMixin, nullable, roAttr, reference,
} from '../../../web-idl/index';
import type { NodeImpl } from './node';
import type { ElementImpl } from './element';

/** Element-sibling navigation shared by elements and character-data nodes. */
// https://dom.spec.whatwg.org/#interface-nondocumenttypechildnode
export class NonDocumentTypeChildNodeMixin {
  /** Node whose sibling chain is searched. */
  #node: NodeImpl;

  constructor(node: NodeImpl) {
    this.#node = node;
  }

  /** Nearest preceding element sibling, skipping other node kinds. */
  // https://dom.spec.whatwg.org/#dom-nondocumenttypechildnode-previouselementsibling
  get previousElementSibling(): ElementImpl | null {
    for (
      let sibling = this.#node.previousSibling;
      sibling;
      sibling = sibling.previousSibling
    ) {
      if (sibling.isElement()) return sibling;
    }

    return null;
  }

  /** Nearest following element sibling, skipping other node kinds. */
  // https://dom.spec.whatwg.org/#dom-nondocumenttypechildnode-nextelementsibling
  get nextElementSibling(): ElementImpl | null {
    for (
      let sibling = this.#node.nextSibling;
      sibling;
      sibling = sibling.nextSibling
    ) {
      if (sibling.isElement()) return sibling;
    }

    return null;
  }
}

/*
 * interface mixin NonDocumentTypeChildNode {
 *   readonly attribute Element? previousElementSibling;
 *   readonly attribute Element? nextElementSibling;
 * };
 */
export const nonDocumentTypeChildNodeIDL = defineInterfaceMixin({
  name: 'NonDocumentTypeChildNode',
  members: [
    roAttr('previousElementSibling', nullable(reference('Element'))),
    roAttr('nextElementSibling', nullable(reference('Element'))),
  ],
});
