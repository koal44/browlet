import { withCommentStub } from '../stubs/interfaces';
import { defineInterface } from '../../web-idl/binding';
import { NodeType } from './node';
import { characterDataIDL, CharacterDataImpl } from './character-data';
import type { DocumentImpl } from './document';

export const commentIDL = defineInterface({
  name: 'Comment',
  parent: characterDataIDL,
  exposed: ['Window'],
  constructible: true,
  members: {},
});

export class CommentImpl
  extends withCommentStub(CharacterDataImpl)
  implements Comment
{
  constructor(
    data = '',
    ownerDocument: DocumentImpl | null = null,
  ) {
    super(NodeType.Comment, data, ownerDocument);
  }
}
