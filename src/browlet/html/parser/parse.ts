import { createDocument, type DocumentImpl, type DocumentConstructionOptions } from '../../dom/nodes/index';
import type { BrowletEnvironment } from '../../environment';

import { HTMLTreeAdapter } from './tree-adapter';

/** Parse source into a new HTML document owned by env. */
export function parseHTMLDocument(
  source = '',
  options: DocumentConstructionOptions = {},
  env: BrowletEnvironment,
): DocumentImpl {
  const document = createDocument(options, env);
  document.type = 'html';
  document.contentType = 'text/html';
  return new HTMLTreeAdapter(document).parse(source);
}
