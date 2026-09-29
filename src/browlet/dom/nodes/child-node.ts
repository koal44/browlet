import {
  defineInterfaceMixin, idlType, op,
} from '../../../web-idl/index';
import type { NodeImpl } from './node';

/** Tree mutations shared by nodes that can occur as children. */
// https://dom.spec.whatwg.org/#interface-childnode
export class ChildNodeMixin {
  /** Node on which the mixin's mutations operate. */
  #node: NodeImpl;

  constructor(node: NodeImpl) {
    this.#node = node;
  }

  // https://dom.spec.whatwg.org/#dom-childnode-remove
  remove(): void {
    this.#node.removeFromTree();
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
  members: [op('remove', idlType.undefined)],
});
