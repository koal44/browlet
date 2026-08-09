import { Parser } from './parser/parser';
import type { Document } from './nodes/document';

export function createDomlet(source = ''): Document {
  return new Parser().parse(source);
}
