import type { Definition } from '../../../../web-idl/index';

import {
  svgElementIDL, svgElementIncludesElementCSSInlineStyleIDL,
  svgElementIncludesHTMLOrSVGOrMathMLElementIDL,
} from './element';
import {
  svgStyleElementIDL, svgStyleElementIncludesLinkStyleIDL,
} from './style-element';
import { svgScriptElementIDL } from './script-element';
import { svgTitleElementIDL } from './title-element';
import { svgGraphicsElementIDL } from './graphics-element';
import { svgSVGElementIDL } from './svg-element';

export const svgIDLDefinitions: Definition[] = [
  svgElementIDL,
  svgElementIncludesElementCSSInlineStyleIDL,
  svgElementIncludesHTMLOrSVGOrMathMLElementIDL,
  svgGraphicsElementIDL,
  svgSVGElementIDL,
  svgStyleElementIDL,
  svgStyleElementIncludesLinkStyleIDL,
  svgScriptElementIDL,
  svgTitleElementIDL,
];
