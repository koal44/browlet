import {
  DocumentImpl, type ElementConstructionResolver,
} from '../dom/nodes/document';
import {
  HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE,
} from '../../shared/namespaces';
import { MathMLElementImpl } from './foreign/mathml-element';
import {
  SVGElementImpl, SVGStyleElementImpl,
} from './foreign/svg-element';
import { HTMLElementImpl } from './html-element';
import { HTMLHeadElementImpl } from './metadata/html-head-element';
import { HTMLLinkElementImpl } from './metadata/html-link-element';
import { HTMLStyleElementImpl } from './metadata/html-style-element';

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
