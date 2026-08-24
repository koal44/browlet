import { HTMLTreeAdapter } from './html-tree-adapter';
import {
  directDOMNodeFactory, DocumentImpl, type DOMNodeFactory,
  type ElementConstructionResolver,
} from '../dom/nodes/document';
import { asDocument } from '../stubs/interfaces';

export function createDocument(
  options: DocumentConstructionOptions = {},
): DocumentImpl {
  const nodeFactory = options.nodeFactory ?? directDOMNodeFactory;
  return nodeFactory.construct(
    DocumentImpl,
    [nodeFactory, options.resolveElementConstruction],
  );
}

export function parseHTMLDocument(
  source = '',
  options: DocumentConstructionOptions = {},
): DocumentImpl & Document {
  const document = createDocument(options);
  DocumentImpl.setType(document, 'html');
  DocumentImpl.setContentType(document, 'text/html');
  return asDocument(new HTMLTreeAdapter(document).parse(source));
}

export type DocumentConstructionOptions = {
  readonly nodeFactory?: DOMNodeFactory;
  readonly resolveElementConstruction?: ElementConstructionResolver;
};
