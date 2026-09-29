import { parseTestDocument } from '../support/dom';
import type { DocumentImpl } from '../../src/browlet/dom/nodes/document';

// Stylelet is host-neutral. These tests exercise it against Browlet's Document
// implementation without constructing a complete Browlet.
export function createBrowletDocument(source = ''): DocumentImpl {
  return parseTestDocument(source);
}
