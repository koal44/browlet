import { withCommentStub } from '../stubs/interfaces';
import { NodeImpl, NodeType } from './node';
import type { DocumentImpl } from './document';

export class CommentImpl
  extends withCommentStub(NodeImpl)
  implements Comment
{
  readonly nodeType = NodeType.Comment;

  constructor(
    public data: string,
    ownerDocument: DocumentImpl | null = null,
  ) {
    super(ownerDocument);
  }
}
