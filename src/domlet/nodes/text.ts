import { withTextStub } from '../stubs/interfaces';
import { NodeImpl, NodeType } from './node';
import type { DocumentImpl } from './document';

export class TextImpl
  extends withTextStub(NodeImpl)
  implements Text
{
  readonly nodeType = NodeType.Text;
  #data: string;

  constructor(data: string, ownerDocument: DocumentImpl | null = null) {
    super(ownerDocument);
    this.#data = data;
  }

  get data(): string {
    return this.#data;
  }

  set data(value: string) {
    this.#data = value;
    this.notifyParentChildrenChanged();
  }
}
