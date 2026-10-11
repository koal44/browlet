import {
  arg, constant, defineCallbackInterface, idlType, integer, op, reference, type IDLCallbackInterface,
} from '../../../web-idl/index';

import type { NodeImpl } from '../nodes/index';

/** Converted author filter; invocation and return conversion belong to its binding. */
export type NodeFilterCallback = {
  acceptNode(node: NodeImpl): number;
};

export const FILTER_ACCEPT = 1;
export const FILTER_REJECT = 2;
export const FILTER_SKIP = 3;
export const SHOW_ALL = 0xffffffff;

// Retain the original callback only at the binding boundary, including object identity
// for NodeIterator.filter and TreeWalker.filter. Traversal receives only the converted invocation contract.
const callbacks = new WeakMap<NodeFilterCallback, IDLCallbackInterface>();

/** Supply the converted callback value to a traversal object's Web IDL getter. */
export function getNodeFilterCallback(filter: NodeFilterCallback | null): IDLCallbackInterface | null {
  return filter === null ? null : callbacks.get(filter)!;
}

// https://dom.spec.whatwg.org/#interface-nodefilter
export const nodeFilterIDL = defineCallbackInterface({
  name: 'NodeFilter', exposed: 'Window',
  toImpl(_ctx, callback): NodeFilterCallback {
    const filter: NodeFilterCallback = {
      acceptNode: (node) => callback.callUserObjectOperation('acceptNode', [node]) as number,
    };
    callbacks.set(filter, callback);
    return filter;
  },
  members: [
    constant('FILTER_ACCEPT', idlType.unsignedShort, integer(FILTER_ACCEPT)),
    constant('FILTER_REJECT', idlType.unsignedShort, integer(FILTER_REJECT)),
    constant('FILTER_SKIP', idlType.unsignedShort, integer(FILTER_SKIP)),
    constant('SHOW_ALL', idlType.unsignedLong, integer(SHOW_ALL)),
    constant('SHOW_ELEMENT', idlType.unsignedLong, integer(0x1)),
    constant('SHOW_ATTRIBUTE', idlType.unsignedLong, integer(0x2)),
    constant('SHOW_TEXT', idlType.unsignedLong, integer(0x4)),
    constant('SHOW_CDATA_SECTION', idlType.unsignedLong, integer(0x8)),
    constant('SHOW_ENTITY_REFERENCE', idlType.unsignedLong, integer(0x10)),
    constant('SHOW_ENTITY', idlType.unsignedLong, integer(0x20)),
    constant('SHOW_PROCESSING_INSTRUCTION', idlType.unsignedLong, integer(0x40)),
    constant('SHOW_COMMENT', idlType.unsignedLong, integer(0x80)),
    constant('SHOW_DOCUMENT', idlType.unsignedLong, integer(0x100)),
    constant('SHOW_DOCUMENT_TYPE', idlType.unsignedLong, integer(0x200)),
    constant('SHOW_DOCUMENT_FRAGMENT', idlType.unsignedLong, integer(0x400)),
    constant('SHOW_NOTATION', idlType.unsignedLong, integer(0x800)),
    op('acceptNode', idlType.unsignedShort, [arg('node', reference('Node'))]),
  ],
});
