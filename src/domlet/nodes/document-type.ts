import { withDocumentTypeStub } from '../stubs/interfaces';
import { NodeImpl, NodeType } from './node';
import type { DocumentImpl } from './document';

export class DocumentTypeImpl
  extends withDocumentTypeStub(NodeImpl)
  implements DocumentType
{
  readonly nodeType = NodeType.DocumentType;

  constructor(
    public name: string,
    public publicId: string,
    public systemId: string,
    ownerDocument: DocumentImpl | null = null,
  ) {
    super(ownerDocument);
  }
}
