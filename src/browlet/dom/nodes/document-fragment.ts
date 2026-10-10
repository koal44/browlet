import {
  atArg, ctor, defineIncludes, defineInterface, impl,
} from '../../../web-idl/index';

import type { DOMEnvironment } from '../environment';

import { NodeImpl, NodeType } from './node';
import { ParentNodeMixin, parentNodeIDL } from './parent-node';
import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';
import type { HTMLCollectionImpl } from './collections';

/** A parent node for a detached subtree, optionally associated with a host element. */
// https://dom.spec.whatwg.org/#interface-documentfragment
export class DocumentFragmentImpl extends NodeImpl {
  /** Associated host for shadow roots or template contents; otherwise null. */
  // https://dom.spec.whatwg.org/#concept-documentfragment-host
  host: ElementImpl | null;

  /** Live child collection and element-child navigation. */
  #parentNodeMixin = new ParentNodeMixin(this);

  constructor(
    ownerDoc: DocumentImpl,
    host: ElementImpl | null = null,
    env: DOMEnvironment,
  ) {
    super(NodeType.DocumentFragment, ownerDoc, env);
    this.host = host;
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

  moveBefore(node: NodeImpl, child: NodeImpl | null): void {
    this.#parentNodeMixin.moveBefore(node, child);
  }
}

/*
 * [Exposed=Window]
 * interface DocumentFragment : Node {
 *   constructor();
 * };
 */
export const documentFragmentIDL = defineInterface<DOMEnvironment>({
  name: 'DocumentFragment',
  inherits: 'Node',
  exposed: 'Window',
  implementation: impl(DocumentFragmentImpl),
  members: [
    ctor(
      [],
      {
        constructWith: [
          atArg(0, (ctx) => ctx.realm.getAssociatedDocument()),
          atArg(2, (ctx) => ctx.getEnvironment()),
        ],
      },
    ),
  ],
});

/*
 * DocumentFragment includes ParentNode;
 */
export const documentFragmentIncludesParentNodeIDL = defineIncludes({
  interface: 'DocumentFragment',
  mixin: parentNodeIDL.name,
});
