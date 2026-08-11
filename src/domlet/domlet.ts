import { DomletParser } from './parser/parser';
import type { Document } from './nodes/document';

export function createDomlet(config: DomletConfig = {}): Document {
  return new DomletParser().parse(config.source ?? '');
}

export type DomletConfig = {
  readonly source?: string;
};
