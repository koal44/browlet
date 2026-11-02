import type { Definition } from '../../../../web-idl/core/index';

import {
  mathMLElementIDL, mathMLElementIncludesElementCSSInlineStyleIDL, mathMLElementIncludesGlobalEventHandlersIDL,
  mathMLElementIncludesHTMLOrSVGOrMathMLElementIDL,
} from './element';

export const mathMLIDLDefinitions: Definition[] = [
  mathMLElementIDL,
  mathMLElementIncludesGlobalEventHandlersIDL,
  mathMLElementIncludesElementCSSInlineStyleIDL,
  mathMLElementIncludesHTMLOrSVGOrMathMLElementIDL,
];
