import {
  createDocument, type DocumentConstructionOptions, DocumentImpl,
} from '../../dom/nodes/document';
import { asDocument } from '../../stubs';
import { HTMLTreeAdapter } from './tree-adapter';

export function parseHTMLDocument(
  source = '',
  options: DocumentConstructionOptions = {},
): DocumentImpl & Document {
  const document = createDocument(options);
  DocumentImpl.setType(document, 'html');
  DocumentImpl.setContentType(document, 'text/html');
  return asDocument(new HTMLTreeAdapter(document).parse(source));
}
