import { withDocumentFragmentStub } from '../../stubs';
import type { EventTargetVirtuals } from '../events/event-target';
import {
  contextValue, ctor, defineIncludes, defineInterface, impl,
} from '../../../web-idl/declaration/index';
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
  readonly #host: ElementImpl | null;
  readonly #parentNodeMixin = new ParentNodeMixin(this);

  constructor(
    ownerDocument: DocumentImpl,
    host: ElementImpl | null = null,
    eventTargetVirtuals?: EventTargetVirtuals,
  ) {
    super(
      NodeType.DocumentFragment,
      ownerDocument,
      { eventTargetVirtuals },
    );
    this.#host = host;
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

const associatedDocument = contextValue(
  (context: { readonly realm: DocumentFragmentRealm; }) =>
    context.realm.getAssociatedDocument(),
);

export const documentFragmentIDL = defineInterface({
  name: 'DocumentFragment',
  inherits: 'Node',
  exposed: 'Window',
  implementation: impl(DocumentFragmentImpl, {
    constructWith: [associatedDocument],
  }),
  members: [ctor()],
});

export const documentFragmentIncludesParentNodeIDL = defineIncludes({
  interface: 'DocumentFragment',
  mixin: parentNodeIDL.name,
});

type DocumentFragmentRealm = {
  getAssociatedDocument(): DocumentImpl;
};
