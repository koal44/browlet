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

  get collapsed(): boolean {
    return this.startContainer === this.endContainer && this.startOffset === this.endOffset;
  }
}

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
