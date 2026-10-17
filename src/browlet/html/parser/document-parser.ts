import type { DocumentImpl } from '../../dom/nodes/index';

/** Owns the document association and lifecycle shared by document parsers. */
// https://html.spec.whatwg.org/multipage/dom.html#active-parser
// TODO(HTML XML parsing): supply an XML parser using this lifecycle too.
export abstract class DocumentParser {
  /** Document receiving nodes and parser lifecycle changes. */
  document: DocumentImpl;
  /** Distinguishes HTML parsing from XML for document readiness timing. */
  abstract kind: 'html' | 'xml';
  /** True once parsing has finished or been aborted. */
  stopped = false;

  constructor(document: DocumentImpl) {
    this.document = document;
    document.parser = this;
  }

  /** Discard further input and stop pending parser continuations. */
  abstract abort(): void;

  /** Release the association after readiness updates, preserving any replacement parser. */
  detach(): void {
    if (this.document.parser === this) this.document.parser = null;
  }
}
