import { InternalError } from '../../../infra/internal-error';

import type { NodeImpl } from '../nodes/index';

/** Reserved iterator owner; construction and registration await DOM traversal. */
// https://dom.spec.whatwg.org/#interface-nodeiterator
export class NodeIteratorImpl {
  constructor() {
    throw new InternalError('NodeIterator construction is not implemented');
  }

  /** Adjust registered iterators before unlinking a subtree. */
  // https://dom.spec.whatwg.org/#nodeiterator-pre-removing-steps
  static preRemove(_node: NodeImpl): void {
    // PROVISIONAL(DOM traversal): no iterators can be constructed or registered yet.
    // Implement registration and adjustment together before enabling construction.
  }
}
