import { withDocumentTypeStub } from '../../stubs';
import {
  defineIncludes, defineInterface, idlType, readonlyAttr,
} from '../../../web-idl/declaration/index';
import { bind } from '../../../web-idl/index';
import { childNodeIDL, NodeImpl, NodeType } from './node';
import type { DocumentImpl } from './document';

/*
 * [Exposed=Window]
 * interface DocumentType : Node {
 *   readonly attribute DOMString name;
 *   readonly attribute DOMString publicId;
 *   readonly attribute DOMString systemId;
 * };
 */
export class DocumentTypeImpl
  extends withDocumentTypeStub(NodeImpl)
  implements DocumentType
{
  #name: string;
  #publicId: string;
  #systemId: string;

  constructor(
    name: string,
    publicId: string,
    systemId: string,
    ownerDocument: DocumentImpl | null = null,
  ) {
    super(NodeType.DocumentType, ownerDocument);
    this.#name = name;
    this.#publicId = publicId;
    this.#systemId = systemId;
  }

  get name(): string {
    return this.#name;
  }

  get publicId(): string {
    return this.#publicId;
  }

  get systemId(): string {
    return this.#systemId;
  }

  // -- Friends ----------------------------------------------------------

  static setIdentifiers(
    doctype: DocumentTypeImpl,
    name: string,
    publicId: string,
    systemId: string,
  ): void {
    doctype.#name = name;
    doctype.#publicId = publicId;
    doctype.#systemId = systemId;
  }
}

// -- Web IDL ------------------------------------------------------------

export const documentTypeIDL = defineInterface({
  binding: bind(DocumentTypeImpl),
  exposed: 'Window',
  inherits: 'Node',
  members: [
    readonlyAttr('name', idlType.DOMString),
    readonlyAttr('publicId', idlType.DOMString),
    readonlyAttr('systemId', idlType.DOMString),
  ],
  name: 'DocumentType',
});

/*
 * DocumentType includes ChildNode;
 */
export const documentTypeIncludesChildNodeIDL = defineIncludes({
  interface: 'DocumentType',
  mixin: childNodeIDL.name,
});
