import { withDocumentTypeStub } from '../../stubs';
import {
  defineIncludes, defineInterface, idlType, roAttr,
} from '../../../web-idl/declaration/index';
import { impl } from '../../../web-idl/index';
import { NodeImpl, NodeType } from './node';
import { ChildNodeMixin, childNodeIDL } from './child-node';
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
  readonly #childNodeMixin = new ChildNodeMixin(this);
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

  remove(): void {
    this.#childNodeMixin.remove();
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
