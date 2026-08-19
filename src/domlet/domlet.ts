import {
  DOMBindings, type DOMRealmHost,
} from './bindings/dom-bindings';
import { DomletParser } from './parser/parser';
import type { DomletDocument } from './nodes/document';

export class Domlet {
  readonly bindings: DOMBindings;

  constructor(host: DOMRealmHost = defaultDOMRealmHost) {
    this.bindings = new DOMBindings(host);
  }

  parse(source = ''): DomletDocument {
    return this.createParser().parse(source);
  }

  createParser(): DomletParser {
    return new DomletParser(this.bindings);
  }
}

const defaultDOMRealmHost: DOMRealmHost = {
  exposure: 'Window',
  eventTimeStamp: () => performance.now(),
};
