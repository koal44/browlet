import type { Definition } from '../../../../web-idl/index';

import {
  svgElementIDL, svgElementIncludesElementCSSInlineStyleIDL,
  svgElementIncludesHTMLOrSVGOrMathMLElementIDL,
} from './element';
import {
  svgStyleElementIDL, svgStyleElementIncludesLinkStyleIDL,
} from './style-element';

export const svgIDLDefinitions: Definition[] = [
  svgElementIDL,
  svgElementIncludesElementCSSInlineStyleIDL,
  svgElementIncludesHTMLOrSVGOrMathMLElementIDL,
  svgStyleElementIDL,
  svgStyleElementIncludesLinkStyleIDL,
];
