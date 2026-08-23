import { withCommentStub } from '../stubs/interfaces';
import { defineInterface, idlType } from '../../web-idl/definition';
import { NodeType } from './node';
import { CharacterDataImpl } from './character-data';
import type { DocumentImpl } from './document';

/*
 * [Exposed=Window]
 * interface Comment : CharacterData {
 *   constructor(optional DOMString data = "");
 * };
 */
export const commentIDL = defineInterface({
  exposed: ['Window'],
  inherits: 'CharacterData',
  members: [{
    arguments: [{
      default: '', name: 'data', optional: true, type: idlType.DOMString,
    }],
    kind: 'constructor',
  }],
  name: 'Comment',
});

// -- Implementation -----------------------------------------------------

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
