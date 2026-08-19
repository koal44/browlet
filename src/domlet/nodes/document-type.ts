import { withDocumentTypeStub } from '../stubs/interfaces';
import {
  defineInterface, readonlyAttribute,
} from '../../web-idl/binding';
import { childNodeIDL, nodeIDL, NodeImpl, NodeType } from './node';
import type { DocumentImpl } from './document';

export const documentTypeIDL = defineInterface({
  name: 'DocumentType',
  parent: nodeIDL,
  exposed: ['Window'],
  includes: [childNodeIDL],
  members: {
    name: readonlyAttribute(),
    publicId: readonlyAttribute(),
    systemId: readonlyAttribute(),
  },
});

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

  get name(): string {
    return this.#name;
  }

  get publicId(): string {
    return this.#publicId;
  }

  get systemId(): string {
    return this.#systemId;
  }
}
