import {
  createDOMBindings, type DOMBindings, type DOMRealmHost,
} from './bindings';
import { DomletParser } from './parser/parser';
import type { DomletDocument } from './nodes/document';

export class Domlet {
  readonly bindings: DOMBindings;

  constructor(host: DOMRealmHost = defaultDOMRealmHost) {
    this.bindings = createDOMBindings(host);
  }

  parse(source = ''): DomletDocument {
    return this.createParser().parse(source);
  }

  createParser(): DomletParser {
    return new DomletParser();
  }
}

const defaultDOMRealmHost: DOMRealmHost = {
  eventTimeStamp: () => performance.now(),
};
