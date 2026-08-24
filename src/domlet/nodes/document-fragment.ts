import { withDocumentFragmentStub } from '../stubs/interfaces';
import type { EventTargetVirtuals } from '../events/event-target';
import { ctor, defineIncludes, defineInterface } from '../../web-idl/declaration/index';
import { bind } from '../../web-idl/index';
import { NodeImpl, NodeType } from './node';
import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';

/*
 * [Exposed=Window]
 * interface DocumentFragment : Node {
 *   constructor();
 * };
 * DocumentFragment includes ParentNode;
 */
export class DocumentFragmentImpl
  extends withDocumentFragmentStub(NodeImpl)
  implements DocumentFragment
{
  readonly #host: ElementImpl | null;

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

  // -- Friends ----------------------------------------------------------

  static getHost(fragment: DocumentFragmentImpl): ElementImpl | null {
    return fragment.#host;
  }
}

// -- Web IDL ------------------------------------------------------------

export const documentFragmentIDL = defineInterface({
  binding: bind(DocumentFragmentImpl, {
    create(context, newTarget) {
      if (!newTarget) {
        throw new Error('DocumentFragment construction requires newTarget');
      }
      return Reflect.construct(
        DocumentFragmentImpl,
        [
          (context.realm as typeof context.realm & DocumentFragmentRealm)
            .getAssociatedDocument(),
        ],
        newTarget as NewTarget,
      );
    },
  }),
  exposed: 'Window',
  inherits: 'Node',
  members: [ctor(bind({ invoke() {} }))],
  name: 'DocumentFragment',
});

export const documentFragmentIncludesParentNodeIDL = defineIncludes({
  interface: 'DocumentFragment',
  mixin: 'ParentNode',
});

type DocumentFragmentRealm = {
  getAssociatedDocument(): DocumentImpl;
};

type NewTarget = new (...argumentsList: never[]) => object;
