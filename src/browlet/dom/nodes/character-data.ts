import { withCharacterDataStub } from '../../stubs';
import {
  annotated, attr, defineIncludes, defineInterface, idlType, xattr,
} from '../../../web-idl/declaration/index';
import { impl } from '../../../web-idl/index';
import { TreeNode } from '../infra/tree';
import {
  NodeImpl, type NodeOptions, type NodeType,
} from './node';
import { ChildNodeMixin, childNodeIDL } from './child-node';
import {
  NonDocumentTypeChildNodeMixin, nonDocumentTypeChildNodeIDL,
} from './non-document-type-child-node';
import type { DocumentImpl } from './document';
import type { ElementImpl } from './element';

/*
 * [Exposed=Window]
 * interface CharacterData : Node {
 *   attribute [LegacyNullToEmptyString] DOMString data;
 *   readonly attribute unsigned long length;
 *   DOMString substringData(unsigned long offset, unsigned long count);
 *   undefined appendData(DOMString data);
 *   undefined insertData(unsigned long offset, DOMString data);
 *   undefined deleteData(unsigned long offset, unsigned long count);
 *   undefined replaceData(unsigned long offset, unsigned long count, DOMString data);
 * };
 */
export class CharacterDataImpl
  extends withCharacterDataStub(NodeImpl)
  implements CharacterData
{
  readonly #childNodeMixin = new ChildNodeMixin(this);
  #data: string;
  readonly #nonDocumentTypeChildNodeMixin =
    new NonDocumentTypeChildNodeMixin(this);

  constructor(
    nodeType: NodeType,
    data: string,
    ownerDocument: DocumentImpl | null,
    options: NodeOptions = {},
  ) {
    super(nodeType, ownerDocument, options);
    this.#data = data;
  }

  get data(): string {
    return this.#data;
  }

  set data(value: string) {
    this.#data = value;
    TreeNode.notifyParentChildrenChanged(this);
  }

  get previousElementSibling(): ElementImpl | null {
    return this.#nonDocumentTypeChildNodeMixin.previousElementSibling;
  }

  get nextElementSibling(): ElementImpl | null {
    return this.#nonDocumentTypeChildNodeMixin.nextElementSibling;
  }

  remove(): void {
    this.#childNodeMixin.remove();
  }
}

// -- Web IDL ------------------------------------------------------------

export const characterDataIDL = defineInterface({
  name: 'CharacterData',
  inherits: 'Node',
  exposed: 'Window',
  implementation: impl(CharacterDataImpl),
  members: [
    // The remaining members depend on the DOM replace-data algorithm.
    attr(
      'data',
      annotated(idlType.DOMString, xattr('LegacyNullToEmptyString')),
    ),
  ],
});

/*
 * CharacterData includes ChildNode;
 */
export const characterDataIncludesChildNodeIDL = defineIncludes({
  interface: 'CharacterData',
  mixin: childNodeIDL.name,
});

/*
 * CharacterData includes NonDocumentTypeChildNode;
 */
export const characterDataIncludesNonDocumentTypeChildNodeIDL = defineIncludes({
  interface: 'CharacterData',
  mixin: nonDocumentTypeChildNodeIDL.name,
});
