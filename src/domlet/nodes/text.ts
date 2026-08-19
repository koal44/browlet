import { withTextStub } from '../stubs/interfaces';
import {
  defineInterface, attribute,
} from '../../web-idl/binding';
import { TreeNode } from '../tree/tree-node';
import {
  childNodeIDL, nodeIDL, NodeImpl, NodeType, nonDocumentTypeChildNodeIDL,
} from './node';
import type { DocumentImpl } from './document';

export const textIDL = defineInterface({
  name: 'Text',
  parent: nodeIDL,
  exposed: ['Window'],
  constructible: true,
  includes: [childNodeIDL, nonDocumentTypeChildNodeIDL],
  members: {
    data: attribute(),
  },
});

export class TextImpl
  extends withTextStub(NodeImpl)
  implements Text
{
  #data: string;

  constructor(data = '', ownerDocument: DocumentImpl | null = null) {
    super(NodeType.Text, ownerDocument);
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
