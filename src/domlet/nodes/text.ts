import { Node, NodeType } from './node';
import type { Document } from './document';

export class Text extends Node {
  readonly nodeType = NodeType.Text;
  #data: string;

  constructor(data: string, ownerDocument: Document | null = null) {
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
