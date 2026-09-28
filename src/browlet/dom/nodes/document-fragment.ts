import { withDocumentFragmentStub } from '../../stubs';
import type { Realm, WindowRealm } from '../../scripting/realm';
import {
  atArg, ctor, defineIncludes, defineInterface, impl,
} from '../../../web-idl/index';
import { NodeImpl, NodeType } from './node';
import { ParentNodeMixin, parentNodeIDL } from './parent-node';
import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';
import type { HTMLCollectionImpl } from './collections';

/*
 * [Exposed=Window]
 * interface DocumentFragment : Node {
 *   constructor();
 * };
 * DocumentFragment includes ParentNode;
 */
export class DocumentFragmentImpl extends withDocumentFragmentStub(NodeImpl) {
  #host: ElementImpl | null;
  #parentNodeMixin = new ParentNodeMixin(this);

  constructor(
    ownerDocument: DocumentImpl,
    host: ElementImpl | null = null,
  ) {
    super(NodeType.DocumentFragment, ownerDocument);
    this.#host = host;
  }

  static is(value: unknown): value is DocumentFragmentImpl {
    return value instanceof DocumentFragmentImpl;
  }

  get children(): HTMLCollectionImpl<ElementImpl> {
    return this.#parentNodeMixin.children;
  }

  get firstElementChild(): ElementImpl | null {
    return this.#parentNodeMixin.firstElementChild;
  }

  get lastElementChild(): ElementImpl | null {
    return this.#parentNodeMixin.lastElementChild;
  }

  get childElementCount(): number {
    return this.#parentNodeMixin.childElementCount;
  }

  // -- Internal ---------------------------------------------------------

  getHost(): ElementImpl | null {
    return this.#host;
  }
}

// -- Web IDL ------------------------------------------------------------

export const documentFragmentIDL = defineInterface<Realm>({
  name: 'DocumentFragment',
  inherits: 'Node',
  exposed: 'Window',
  implementation: impl(DocumentFragmentImpl),
  members: [
    ctor(
      [],
      // Exposed=Window narrows the realm; the shared declaration registry also serves other globals.
      { constructWith: [atArg(0, (ctx) => (ctx.realm as WindowRealm).getAssociatedDocument())] },
    ),
  ],
});

export const documentFragmentIncludesParentNodeIDL = defineIncludes({
  interface: 'DocumentFragment',
  mixin: parentNodeIDL.name,
});
