import { DomletParser } from './parser/parser';
import type { DomletDocument } from './nodes/document';
import {
  directDOMNodeFactory, type DOMNodeFactory,
} from './nodes/factory';

export class Domlet {
  readonly #nodeFactory: DOMNodeFactory;

  constructor(nodeFactory: DOMNodeFactory = directDOMNodeFactory) {
    this.#nodeFactory = nodeFactory;
  }

  parse(source = ''): DomletDocument {
    return this.createParser().parse(source);
  }

  createParser(): DomletParser {
    return new DomletParser(this.#nodeFactory);
  }
}
