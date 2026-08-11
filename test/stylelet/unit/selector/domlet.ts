import { createDomlet } from '../../../../src/domlet/domlet';

export function createDomletDocument(source: string): Document {
  return createDomlet({ source }) as unknown as Document;
}
