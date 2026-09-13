import {
  defineInterfaceMixin, idlType, op,
} from '../../../web-idl/index';
import type { NodeImpl } from './node';

/*
 * interface mixin ChildNode {
 *   [CEReactions, Unscopable] undefined before((Node or DOMString)... nodes);
 *   [CEReactions, Unscopable] undefined after((Node or DOMString)... nodes);
 *   [CEReactions, Unscopable] undefined replaceWith((Node or DOMString)... nodes);
 *   [CEReactions, Unscopable] undefined remove();
 * };
 */
export class ChildNodeMixin {
  readonly #node: NodeImpl;

  constructor(node: NodeImpl) {
    this.#node = node;
  }

  remove(): void {
    this.#node.removeFromTree();
  }
}

// -- Web IDL ------------------------------------------------------------

export const childNodeIDL = defineInterfaceMixin({
  name: 'ChildNode',
  members: [op('remove', idlType.undefined)],
});
