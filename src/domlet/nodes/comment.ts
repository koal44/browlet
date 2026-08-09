import { Node, NodeType } from './node';
import type { Document } from './document';

export class Comment extends Node {
  readonly nodeType = NodeType.Comment;

  constructor(public data: string, ownerDocument: Document | null = null) {
    super(ownerDocument);
  }
}
