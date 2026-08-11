import { DomletParser } from './parser/parser';
import type { DomletDocument } from './nodes/document';

export function createDomlet(config: DomletConfig = {}): DomletDocument {
  return new DomletParser().parse(config.source ?? '');
}

export type DomletConfig = {
  readonly source?: string;
};
