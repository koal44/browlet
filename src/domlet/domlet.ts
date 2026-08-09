import { DomletParser } from './parser/parser';
import type { Document } from './nodes/document';

export function createDomlet(source = ''): Document {
  return new DomletParser().parse(source);
}
