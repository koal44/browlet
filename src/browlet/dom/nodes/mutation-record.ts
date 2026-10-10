import { defineInterface, idlType, impl, nullable, reference, roAttr, xattr } from '../../../web-idl/index';

import { NodeListImpl } from './collections';
import type { NodeImpl } from './node';

/** One observed mutation, with static node lists and retained node identities. */
// https://dom.spec.whatwg.org/#interface-mutationrecord
export class MutationRecordImpl {
  type: MutationType;
  /** Node whose children, attribute, or character data changed. */
  target: NodeImpl;
  /** Static list of inserted nodes, unaffected by later tree mutations. */
  addedNodes: NodeListImpl;
  /** Static list of removed nodes, unaffected by later tree mutations. */
  removedNodes: NodeListImpl;
  /** Sibling preceding the changed span, or null at the beginning of the child list. */
  previousSibling: NodeImpl | null;
  /** Sibling following the changed span, or null at the end of the child list. */
  nextSibling: NodeImpl | null;
  /** Changed attribute's local name; null for other mutation kinds. */
  attributeName: string | null;
  /** Changed attribute's namespace; null for unnamespaced attributes and other mutation kinds. */
  attributeNamespace: string | null;
  /** Prior data or attribute value when requested by this observer; otherwise null. */
  oldValue: string | null;

  constructor(
    type: MutationType, target: NodeImpl, name: string | null, namespace: string | null,
    oldValue: string | null, addedNodes: NodeImpl[], removedNodes: NodeImpl[],
    previousSibling: NodeImpl | null, nextSibling: NodeImpl | null,
  ) {
    this.type = type;
    this.target = target;
    this.addedNodes = new NodeListImpl(addedNodes);
    this.removedNodes = new NodeListImpl(removedNodes);
    this.previousSibling = previousSibling;
    this.nextSibling = nextSibling;
    this.attributeName = name;
    this.attributeNamespace = namespace;
    this.oldValue = oldValue;
  }
}

export type MutationType = 'attributes' | 'characterData' | 'childList';

/*
 * [Exposed=Window]
 * interface MutationRecord {
 *   readonly attribute DOMString type;
 *   [SameObject] readonly attribute Node target;
 *   [SameObject] readonly attribute NodeList addedNodes;
 *   [SameObject] readonly attribute NodeList removedNodes;
 *   readonly attribute Node? previousSibling;
 *   readonly attribute Node? nextSibling;
 *   readonly attribute DOMString? attributeName;
 *   readonly attribute DOMString? attributeNamespace;
 *   readonly attribute DOMString? oldValue;
 * };
 */
export const mutationRecordIDL = defineInterface({
  name: 'MutationRecord',
  exposed: 'Window',
  implementation: impl(MutationRecordImpl),
  members: [
    roAttr('type', idlType.DOMString),
    roAttr('target', reference('Node'), xattr('SameObject')),
    roAttr('addedNodes', reference('NodeList'), xattr('SameObject')),
    roAttr('removedNodes', reference('NodeList'), xattr('SameObject')),
    roAttr('previousSibling', nullable(reference('Node'))),
    roAttr('nextSibling', nullable(reference('Node'))),
    roAttr('attributeName', nullable(idlType.DOMString)),
    roAttr('attributeNamespace', nullable(idlType.DOMString)),
    roAttr('oldValue', nullable(idlType.DOMString)),
  ],
});
