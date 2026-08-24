import {
  directDOMNodeFactory, DocumentImpl, type DOMNodeFactory,
  type ElementConstructionResolver,
} from './dom/nodes/document';
import { HTMLElementImpl } from './html/elements/html-element';
import { HTMLHeadElementImpl } from './html/elements/metadata/head';
import { HTMLLinkElementImpl } from './html/elements/metadata/link';
import { HTMLStyleElementImpl } from './html/elements/metadata/style';
import { MathMLElementImpl } from './mathml/element';
import { SVGElementImpl } from './svg/element';
import { SVGStyleElementImpl } from './svg/style-element';
import {
  HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE,
} from '../shared/namespaces';

export function createDocument(
  options: DocumentConstructionOptions = {},
): DocumentImpl {
  const nodeFactory = options.nodeFactory ?? directDOMNodeFactory;
  return nodeFactory.construct(
    DocumentImpl,
    [
      nodeFactory,
      options.resolveElementConstruction ?? resolveBrowletElementConstruction,
    ],
  );
}

export const resolveBrowletElementConstruction: ElementConstructionResolver = (
  document,
  localName,
  namespaceURI,
  attributes,
) => {
  if (namespaceURI === HTML_NAMESPACE) {
    if (localName === 'head') {
      return {
        implementation: HTMLHeadElementImpl,
        argumentsList: [document, attributes],
      };
    }
    if (localName === 'style') {
      return {
        implementation: HTMLStyleElementImpl,
        argumentsList: [
          document,
          DocumentImpl.getTreeScopeResolver(document),
          attributes,
        ],
      };
    }
    if (localName === 'link') {
      return {
        implementation: HTMLLinkElementImpl,
        argumentsList: [
          document,
          DocumentImpl.getTreeScopeResolver(document),
          attributes,
        ],
      };
    }
    return {
      implementation: HTMLElementImpl,
      argumentsList: [localName, document, attributes],
    };
  }

  if (namespaceURI === SVG_NAMESPACE) {
    return localName === 'style'
      ? {
        implementation: SVGStyleElementImpl,
        argumentsList: [
          document,
          DocumentImpl.getTreeScopeResolver(document),
          attributes,
        ],
      }
      : {
        implementation: SVGElementImpl,
        argumentsList: [localName, document, attributes],
      };
  }

  if (namespaceURI === MATHML_NAMESPACE) {
    return {
      implementation: MathMLElementImpl,
      argumentsList: [localName, document, attributes],
    };
  }
};

export type DocumentConstructionOptions = {
  readonly nodeFactory?: DOMNodeFactory;
  readonly resolveElementConstruction?: ElementConstructionResolver;
};
