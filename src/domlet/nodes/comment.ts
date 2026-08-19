import { withCommentStub } from '../stubs/interfaces';
import { attribute, defineInterface } from '../../web-idl/binding';
import {
  childNodeIDL, nodeIDL, NodeImpl, NodeType, nonDocumentTypeChildNodeIDL,
} from './node';
import type { DocumentImpl } from './document';

export const commentIDL = defineInterface({
  name: 'Comment',
  parent: nodeIDL,
  exposed: ['Window'],
  constructible: true,
  includes: [childNodeIDL, nonDocumentTypeChildNodeIDL],
  members: {
    data: attribute(),
  },
});

export class CommentImpl
  extends withCommentStub(NodeImpl)
  implements Comment
{
  #data: string;

  constructor(
    data = '',
    ownerDocument: DocumentImpl | null = null,
  ) {
    super(NodeType.Comment, ownerDocument);
    this.#data = data;
  }

  get data(): string {
    return this.#data;
  }

  set data(value: string) {
    this.#data = value;
  }
}
