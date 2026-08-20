import { withCharacterDataStub } from '../stubs/interfaces';
import {
  annotated, defineIncludes, defineInterface, idlType,
} from '../../web-idl/definition';
import { TreeNode } from '../tree/tree-node';
import {
  childNodeIDL, NodeImpl, type NodeOptions, type NodeType,
  nonDocumentTypeChildNodeIDL,
} from './node';
import type { DocumentImpl } from './document';

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

export const characterDataIDL = defineInterface({
  exposed: ['Window'],
  inherits: 'Node',
  members: [
    // The remaining members depend on the DOM replace-data algorithm.
    {
      kind: 'attribute',
      name: 'data',
      type: annotated(idlType.DOMString, [{
        kind: 'no-arguments', name: 'LegacyNullToEmptyString',
      }]),
    },
  ],
  name: 'CharacterData',
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

export class CharacterDataImpl
  extends withCharacterDataStub(NodeImpl)
  implements CharacterData
{
  #data: string;

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
}
