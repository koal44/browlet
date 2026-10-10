import { InternalError } from '../../../infra/internal-error';

import type { NodeImpl } from '../nodes/index';

/** Reserved live-range owner; construction and registration await DOM ranges. */
// https://dom.spec.whatwg.org/#interface-range
export class RangeImpl {
  constructor() {
    throw new InternalError('Live Range construction is not implemented');
  }

  /** Adjust live boundary points after an insertion index. */
  // https://dom.spec.whatwg.org/#concept-node-insert
  static adjustForInsertion(_parent: NodeImpl, _index: number, _count: number): void {
    // PROVISIONAL(DOM ranges): no live ranges can be constructed or registered yet.
    // Implement registration and adjustment together before enabling construction.
  }

  /** Move live boundary points out of a subtree before it is removed. */
  // https://dom.spec.whatwg.org/#live-range-pre-remove-steps
  static preRemove(_node: NodeImpl): void {
    // PROVISIONAL(DOM ranges): the live-range collection is necessarily empty.
  }
}
