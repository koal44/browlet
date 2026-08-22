import { DomletParser } from './parser/parser';
import { DocumentImpl, type DomletDocument } from './nodes/document';
import {
  directDOMNodeFactory, type DOMNodeFactory,
} from './nodes/factory';
import { asDocument } from './stubs/interfaces';

export class Domlet {
  readonly #nodeFactory: DOMNodeFactory;

  constructor(nodeFactory: DOMNodeFactory = directDOMNodeFactory) {
    this.#nodeFactory = nodeFactory;
  }

  parse(source = ''): DomletDocument {
    const document = this.createDocument();
    DocumentImpl.setType(document, 'html');
    DocumentImpl.setContentType(document, 'text/html');
    return this.createParser(document).parse(source);
  }

  createDocument(): DomletDocument {
    return asDocument(this.#nodeFactory.construct(
      DocumentImpl,
      [this.#nodeFactory],
    ));
  }

  createParser(document: DomletDocument): DomletParser {
    return new DomletParser(document, this.#nodeFactory);
  }
}
