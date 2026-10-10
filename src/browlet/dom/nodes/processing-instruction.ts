import type { DOMEnvironment } from '../environment';

import { NodeType } from './node';
import { CharacterDataImpl } from './character-data';
import type { DocumentImpl } from './document';

/** Processing-instruction target and character data retained in a document. */
// https://dom.spec.whatwg.org/#interface-processinginstruction
// PROVISIONAL(DOM 4I): initialization validation, pseudo-attributes, and public construction remain unimplemented.
export class ProcessingInstructionImpl extends CharacterDataImpl {
  /** Application to which this processing instruction is directed. */
  target: string;

  constructor(target: string, data: string, ownerDoc: DocumentImpl, env: DOMEnvironment) {
    super(NodeType.ProcessingInstruction, data, ownerDoc, env);
    this.target = target;
  }

  /** Synchronize pseudo-attributes after character-data replacement. */
  // https://dom.spec.whatwg.org/#update-attributes-from-data
  updateAttributesFromData(): void {
    // PROVISIONAL(DOM 4I): parse data into the attribute map when pseudo-attributes are implemented.
  }
}
