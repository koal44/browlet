import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, idlType, impl, reference,
  DOMExceptionImpl, DOMExceptionNames,
} from '../../../web-idl/core/index';

import type { NodeImpl } from '../nodes/index';
import type { DOMEnvironment } from '../environment';

import { AbstractRangeImpl } from './abstract-range';

/** A snapshot of supplied boundary points, with no live mutation registration. */
// https://dom.spec.whatwg.org/#interface-staticrange
export class StaticRangeImpl extends AbstractRangeImpl {
  constructor(init: StaticRangeInitRecord, env: DOMEnvironment) {
    const { startContainer, startOffset, endContainer, endOffset } = init;
    if (startContainer.isDocumentType() || startContainer.isAttribute() ||
      endContainer.isDocumentType() || endContainer.isAttribute()) {
      throw new DOMExceptionImpl('', DOMExceptionNames.invalidNodeType);
    }
    // Construction deliberately permits reversed, disconnected, and out-of-bounds points.
    super(startContainer, startOffset, endContainer, endOffset, env);
  }

  /** Check this snapshot against the current tree without repairing or moving its endpoints. */
  // https://dom.spec.whatwg.org/#staticrange-valid
  isValid(): boolean {
    return this.startContainer.getRoot() === this.endContainer.getRoot() &&
      this.startOffset >= 0 && this.startOffset <= this.startContainer.getLength() &&
      this.endOffset >= 0 && this.endOffset <= this.endContainer.getLength() &&
      AbstractRangeImpl.compareBoundaryPoints(
        this.startContainer, this.startOffset, this.endContainer, this.endOffset,
      ) !== 1;
  }
}

export type StaticRangeInitRecord = {
  startContainer: NodeImpl;
  startOffset: number;
  endContainer: NodeImpl;
  endOffset: number;
};

/*
 * dictionary StaticRangeInit {
 *   required Node startContainer;
 *   required unsigned long startOffset;
 *   required Node endContainer;
 *   required unsigned long endOffset;
 * };
 */
export const staticRangeInitIDL = defineDictionary({
  name: 'StaticRangeInit',
  members: [
    dictMember('startContainer', reference('Node'), { required: true }),
    dictMember('startOffset', idlType.unsignedLong, { required: true }),
    dictMember('endContainer', reference('Node'), { required: true }),
    dictMember('endOffset', idlType.unsignedLong, { required: true }),
  ],
});

/*
 * [Exposed=Window]
 * interface StaticRange : AbstractRange {
 *   constructor(StaticRangeInit init);
 * };
 */
export const staticRangeIDL = defineInterface<DOMEnvironment>({
  name: 'StaticRange', inherits: 'AbstractRange', exposed: 'Window',
  implementation: impl(StaticRangeImpl, { constructWith: [atArg(1, (env) => env)] }),
  members: [ctor([arg('init', reference('StaticRangeInit'))])],
});
