import { Node, NodeType } from './node';
import type { Document } from './document';

export class Text extends Node {
  readonly nodeType = NodeType.Text;

  constructor(public data: string, ownerDocument: Document | null = null) {
    super(ownerDocument);
  }
}
