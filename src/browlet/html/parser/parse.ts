import {
  createDocument, type DocumentImpl, type DocumentConstructionOptions,
} from '../../dom/nodes/document';
import { asDocument } from '../../stubs';
import { HTMLTreeAdapter } from './tree-adapter';

export function parseHTMLDocument(
  source = '',
  options: DocumentConstructionOptions = {},
): DocumentImpl & Document {
  const document = createDocument(options);
  document.setType('html');
  document.setContentType('text/html');
  return asDocument(new HTMLTreeAdapter(document).parse(source));
}
