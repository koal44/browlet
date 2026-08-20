import { withDocumentFragmentStub } from '../stubs/interfaces';
import type { EventTargetVirtuals } from '../events/event-target';
import { defineInterface } from '../../web-idl/definition';
import { NodeImpl, NodeType } from './node';
import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';

/*
 * [Exposed=Window]
 * interface DocumentFragment : Node {
 *   constructor();
 * };
 */

export const documentFragmentIDL = defineInterface({
  exposed: ['Window'],
  inherits: 'Node',
  members: [{ arguments: [], kind: 'constructor' }],
  name: 'DocumentFragment',
});

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
