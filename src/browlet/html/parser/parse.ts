import type { DocumentImpl } from '../../dom/nodes/index';
import type { BrowletEnvironment } from '../../environment';

import { HTMLTreeAdapter } from './tree-adapter';

/** Parse source into a new HTML document owned by env. */
export function parseHTMLDocument(
  source = '',
  env: BrowletEnvironment,
): DocumentImpl {
  const document = env.createDocument();
  document.type = 'html';
  document.contentType = 'text/html';
  return new HTMLTreeAdapter(document).parse(source);
}
