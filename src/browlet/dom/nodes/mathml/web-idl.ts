import type { Definition } from '../../../../web-idl/index';

import {
  mathMLElementIDL, mathMLElementIncludesElementCSSInlineStyleIDL,
  mathMLElementIncludesHTMLOrSVGOrMathMLElementIDL,
} from './element';

export const mathMLIDLDefinitions: Definition[] = [
  mathMLElementIDL,
  mathMLElementIncludesElementCSSInlineStyleIDL,
  mathMLElementIncludesHTMLOrSVGOrMathMLElementIDL,
];
