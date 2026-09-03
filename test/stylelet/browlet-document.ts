import { parseHTMLDocument } from '../../src/browlet/html/parser/parse';

/*
 * Stylelet is host-neutral. These tests intentionally exercise it against
 * Browlet's Document implementation without constructing a complete Browlet.
 */
export function createBrowletDocument(source = ''): Document {
  return parseHTMLDocument(source);
}
