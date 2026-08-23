import { withDocumentTypeStub } from '../stubs/interfaces';
import {
  defineIncludes, defineInterface, idlType,
} from '../../web-idl/definition';
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
export const documentTypeIDL = defineInterface({
  exposed: ['Window'],
  inherits: 'Node',
  members: [
    { kind: 'attribute', name: 'name', readonly: true, type: idlType.DOMString },
    { kind: 'attribute', name: 'publicId', readonly: true, type: idlType.DOMString },
    { kind: 'attribute', name: 'systemId', readonly: true, type: idlType.DOMString },
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

// -- Implementation -----------------------------------------------------

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
