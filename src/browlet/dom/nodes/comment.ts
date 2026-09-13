import { withCommentStub } from '../../stubs';
import { arg, ctor, defineInterface, idlType } from '../../../web-idl/declaration/index';
import { impl } from '../../../web-idl/index';
import { NodeType } from './node';
import { CharacterDataImpl } from './character-data';
import type { DocumentImpl } from './document';

/*
 * [Exposed=Window]
 * interface Comment : CharacterData {
 *   constructor(optional DOMString data = "");
 * };
 */
export class CommentImpl extends withCommentStub(CharacterDataImpl) {
  constructor(
    data: string,
    ownerDocument: DocumentImpl | null = null,
  ) {
    super(NodeType.Comment, data, ownerDocument);
  }
}

// -- Web IDL ------------------------------------------------------------

export const commentIDL = defineInterface({
  name: 'Comment',
  inherits: 'CharacterData',
  exposed: 'Window',
  implementation: impl(CommentImpl),
  members: [ctor([
    arg('data', idlType.DOMString, { default: '', optional: true }),
  ])],
});
