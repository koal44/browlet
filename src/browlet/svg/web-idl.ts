import type { Definition } from '../../web-idl/declaration/index';
import {
  svgElementIDL, svgElementIncludesElementCSSInlineStyleIDL,
} from './element';
import {
  svgStyleElementIDL, svgStyleElementIncludesLinkStyleIDL,
} from './style-element';

export const svgIDLDefinitions: Definition[] = [
  svgElementIDL,
  svgElementIncludesElementCSSInlineStyleIDL,
  svgStyleElementIDL,
  svgStyleElementIncludesLinkStyleIDL,
];
