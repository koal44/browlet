import { DomletParser } from './parser/parser';
import type {
  DocumentInitialization, DomletDocument,
} from './nodes/document';
import {
  directDOMNodeFactory, type DOMNodeFactory,
} from './nodes/factory';

export class Domlet {
  readonly #nodeFactory: DOMNodeFactory;

  constructor(nodeFactory: DOMNodeFactory = directDOMNodeFactory) {
    this.#nodeFactory = nodeFactory;
  }

  parse(
    source = '',
    initialization: DocumentInitialization = {},
  ): DomletDocument {
    return this.createParser(initialization).parse(source);
  }

  createParser(initialization: DocumentInitialization = {}): DomletParser {
    return new DomletParser(this.#nodeFactory, initialization);
  }
}
