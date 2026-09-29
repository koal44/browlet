import { defineIncludes, defineInterface, idlType, impl, roAttr } from '../../../web-idl/index';
import { NodeImpl, NodeType } from './node';
import { ChildNodeMixin, childNodeIDL } from './child-node';
import type { DocumentImpl } from './document';
import type { DOMEnvironment } from '../environment';

/** Document type declaration retaining its name and external identifiers. */
// https://dom.spec.whatwg.org/#interface-documenttype
export class DocumentTypeImpl extends NodeImpl {
  /** Declared document type name. */
  name: string;
  /** Public identifier, or the empty string when absent. */
  publicId: string;
  /** System identifier, or the empty string when absent. */
  systemId: string;

  /** Child-node mutation behavior shared with other removable nodes. */
  #childNodeMixin = new ChildNodeMixin(this);

  constructor(
    name: string,
    publicId: string,
    systemId: string,
    ownerDoc: DocumentImpl,
    env: DOMEnvironment,
  ) {
    super(NodeType.DocumentType, ownerDoc, env);
    this.name = name;
    this.publicId = publicId;
    this.systemId = systemId;
  }

  static is(value: unknown): value is DocumentTypeImpl {
    return value instanceof DocumentTypeImpl;
  }

  remove(): void {
    this.#childNodeMixin.remove();
  }
}

/*
 * [Exposed=Window]
 * interface DocumentType : Node {
 *   readonly attribute DOMString name;
 *   readonly attribute DOMString publicId;
 *   readonly attribute DOMString systemId;
 * };
 */
export const documentTypeIDL = defineInterface({
  name: 'DocumentType',
  inherits: 'Node',
  exposed: 'Window',
  implementation: impl(DocumentTypeImpl),
  members: [
    roAttr('name', idlType.DOMString),
    roAttr('publicId', idlType.DOMString),
    roAttr('systemId', idlType.DOMString),
  ],
});

/*
 * DocumentType includes ChildNode;
 */
export const documentTypeIncludesChildNodeIDL = defineIncludes({
  interface: 'DocumentType',
  mixin: childNodeIDL.name,
});
