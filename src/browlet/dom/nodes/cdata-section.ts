import { defineInterface, impl } from '../../../web-idl/core/index';

import type { DocumentImpl } from './document';
import { NodeType } from './node';
import { TextImpl } from './text';

/** XML character data with a distinct node kind, retaining Text's traversal and mutation behavior. */
// https://dom.spec.whatwg.org/#interface-cdatasection
export class CDATASectionImpl extends TextImpl {
  constructor(data: string, document: DocumentImpl) {
    super(data, document);
    this.nodeType = NodeType.CDATASection;
  }
}

/*
 * [Exposed=Window]
 * interface CDATASection : Text {};
 */
export const cdataSectionIDL = defineInterface({
  name: 'CDATASection', inherits: 'Text', exposed: 'Window',
  implementation: impl(CDATASectionImpl), members: [],
});
