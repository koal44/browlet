import { arg, atArg, ctor, defineInterface, idlType, impl } from '../../../web-idl/index';
import { NodeType } from './node';
import { CharacterDataImpl } from './character-data';
import type { DocumentImpl } from './document';
import type { DOMEnvironment } from '../environment';

/** Comment text retained as a character-data node in the document tree. */
// https://dom.spec.whatwg.org/#interface-comment
export class CommentImpl extends CharacterDataImpl {
  constructor(
    data: string,
    ownerDoc: DocumentImpl | null = null,
    env: DOMEnvironment,
  ) {
    super(NodeType.Comment, data, ownerDoc, env);
  }

  static is(value: unknown): value is CommentImpl {
    return value instanceof CommentImpl;
  }
}

/*
 * [Exposed=Window]
 * interface Comment : CharacterData {
 *   constructor(optional DOMString data = "");
 * };
 */
export const commentIDL = defineInterface<DOMEnvironment>({
  name: 'Comment',
  inherits: 'CharacterData',
  exposed: 'Window',
  implementation: impl(CommentImpl, {
    constructWith: [atArg(2, (ctx) => ctx.getEnvironment())],
  }),
  members: [ctor([
    arg('data', idlType.DOMString, { default: '', optional: true }),
  ])],
});
