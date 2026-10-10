import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, idlType, impl, reference,
  DOMExceptionImpl, DOMExceptionNames,
} from '../../../web-idl/index';

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
}

export type StaticRangeInitRecord = {
  startContainer: NodeImpl;
  startOffset: number;
  endContainer: NodeImpl;
  endOffset: number;
};

export const staticRangeInitIDL = defineDictionary({
  name: 'StaticRangeInit',
  members: [
    dictMember('startContainer', reference('Node'), { required: true }),
    dictMember('startOffset', idlType.unsignedLong, { required: true }),
    dictMember('endContainer', reference('Node'), { required: true }),
    dictMember('endOffset', idlType.unsignedLong, { required: true }),
  ],
});

export const staticRangeIDL = defineInterface<DOMEnvironment>({
  name: 'StaticRange', inherits: 'AbstractRange', exposed: 'Window',
  implementation: impl(StaticRangeImpl, { constructWith: [atArg(1, (ctx) => ctx.getEnvironment())] }),
  members: [ctor([arg('init', reference('StaticRangeInit'))])],
});
