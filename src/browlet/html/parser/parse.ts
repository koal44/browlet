import {
  createDocument, type DocumentImpl, type DocumentConstructionOptions,
} from '../../dom/nodes/document';
import { HTMLTreeAdapter } from './tree-adapter';
import type { Environment } from '../../scripting/environment';

export function parseHTMLDocument(
  source = '',
  options: DocumentConstructionOptions = {},
  env: Environment,
): DocumentImpl {
  const document = createDocument(options, env);
  document.type = 'html';
  document.contentType = 'text/html';
  return new HTMLTreeAdapter(document).parse(source);
}
