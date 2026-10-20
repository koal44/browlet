import type { Definition } from '../../../../web-idl/core/index';

import {
  mathMLElementIDL, mathMLElementIncludesElementCSSInlineStyleIDL,
  mathMLElementIncludesHTMLOrSVGOrMathMLElementIDL,
} from './element';

export const mathMLIDLDefinitions: Definition[] = [
  mathMLElementIDL,
  mathMLElementIncludesElementCSSInlineStyleIDL,
  mathMLElementIncludesHTMLOrSVGOrMathMLElementIDL,
];
