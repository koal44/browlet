import { InternalError } from '../../../infra/internal-error';
import { defineInterface, idlType, impl, reference, roAttr } from '../../../web-idl/index';

import type { NodeImpl } from '../nodes/index';
import type { DOMEnvironment } from '../environment';

/** Boundary state shared by live and static ranges. */
// https://dom.spec.whatwg.org/#interface-abstractrange
export class AbstractRangeImpl {
  /** Execution owner; endpoints may subsequently belong to another document. */
  env: DOMEnvironment;
  /** Boundary nodes and UTF-16 or child offsets, maintained by the owning range. */
  startContainer: NodeImpl;
  startOffset: number;
  endContainer: NodeImpl;
  endOffset: number;

  constructor(
    startContainer: NodeImpl, startOffset: number, endContainer: NodeImpl, endOffset: number,
    env: DOMEnvironment,
  ) {
    this.env = env;
    this.startContainer = startContainer;
    this.startOffset = startOffset;
    this.endContainer = endContainer;
    this.endOffset = endOffset;
  }

  /** Compare two boundary points in the same ordinary tree without allocating point objects. */
  // https://dom.spec.whatwg.org/#concept-range-bp-position
  static compareBoundaryPoints(
    nodeA: NodeImpl, offsetA: number, nodeB: NodeImpl, offsetB: number,
  ): -1 | 0 | 1 {
    if (nodeA === nodeB) return offsetA === offsetB ? 0 : offsetA < offsetB ? -1 : 1;
    const position = nodeA.comparePosition(nodeB);
    if (position === null) throw new InternalError('Boundary-point comparison requires a shared root');
    if (position === 1) return this.compareBoundaryPoints(nodeB, offsetB, nodeA, offsetA) === -1 ? 1 : -1;
    if (nodeA.contains(nodeB)) {
      let child = nodeB;
      while (child.parentNode !== nodeA) child = child.parentNode!;
      if (child.getIndex() < offsetA) return 1;
    }
    return -1;
  }

  /** Whether both endpoints identify the same position. */
  // https://dom.spec.whatwg.org/#range-collapsed
  get collapsed(): boolean {
    return this.startContainer === this.endContainer && this.startOffset === this.endOffset;
  }
}

/*
 * [Exposed=Window]
 * interface AbstractRange {
 *   readonly attribute Node startContainer;
 *   readonly attribute unsigned long startOffset;
 *   readonly attribute Node endContainer;
 *   readonly attribute unsigned long endOffset;
 *   readonly attribute boolean collapsed;
 * };
 */
export const abstractRangeIDL = defineInterface({
  name: 'AbstractRange', exposed: 'Window', implementation: impl(AbstractRangeImpl),
  members: [
    roAttr('startContainer', reference('Node')),
    roAttr('startOffset', idlType.unsignedLong),
    roAttr('endContainer', reference('Node')),
    roAttr('endOffset', idlType.unsignedLong),
    roAttr('collapsed', idlType.boolean),
  ],
});
