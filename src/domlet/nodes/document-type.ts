import { Node, NodeType } from './node';
import type { Document } from './document';

export class DocumentType extends Node {
  readonly nodeType = NodeType.DocumentType;

  constructor(
    public name: string,
    public publicId: string,
    public systemId: string,
    ownerDocument: Document | null = null,
  ) {
    super(ownerDocument);
  }
}
