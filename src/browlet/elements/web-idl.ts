import type { Definition } from '../../web-idl/declaration/index';
import {
  mathMLElementIDL, mathMLElementIncludesElementCSSInlineStyleIDL,
} from './foreign/mathml-element';
import {
  svgElementIDL, svgElementIncludesElementCSSInlineStyleIDL,
  svgStyleElementIDL, svgStyleElementIncludesLinkStyleIDL,
} from './foreign/svg-element';
import {
  htmlElementIDL, htmlElementIncludesElementCSSInlineStyleIDL,
} from './html-element';
import { htmlHeadElementIDL } from './metadata/html-head-element';
import {
  htmlLinkElementIDL, htmlLinkElementIncludesLinkStyleIDL,
} from './metadata/html-link-element';
import {
  htmlStyleElementIDL, htmlStyleElementIncludesLinkStyleIDL,
} from './metadata/html-style-element';

export const browletElementIDLDefinitions: Definition[] = [
  htmlElementIDL,
  htmlElementIncludesElementCSSInlineStyleIDL,
  htmlHeadElementIDL,
  htmlStyleElementIDL,
  htmlStyleElementIncludesLinkStyleIDL,
  htmlLinkElementIDL,
  htmlLinkElementIncludesLinkStyleIDL,
  svgElementIDL,
  svgElementIncludesElementCSSInlineStyleIDL,
  svgStyleElementIDL,
  svgStyleElementIncludesLinkStyleIDL,
  mathMLElementIDL,
  mathMLElementIncludesElementCSSInlineStyleIDL,
];
