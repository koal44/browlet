import { withCommentStub } from '../../stubs/interfaces';
import { arg, ctor, defineInterface, idlType } from '../../../web-idl/declaration/index';
import { bind } from '../../../web-idl/index';
import { NodeType } from './node';
import { CharacterDataImpl } from './character-data';
import type { DocumentImpl } from './document';

/*
 * [Exposed=Window]
 * interface Comment : CharacterData {
 *   constructor(optional DOMString data = "");
 * };
 */
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

// -- Web IDL ------------------------------------------------------------

export const commentIDL = defineInterface({
  binding: bind(CommentImpl),
  exposed: 'Window',
  inherits: 'CharacterData',
  members: [ctor([
    arg('data', idlType.DOMString, { default: '', optional: true }),
  ], bind({
    invoke(_context, data) {
      (this as CommentImpl).data = data as string;
    },
  }))],
  name: 'Comment',
});
