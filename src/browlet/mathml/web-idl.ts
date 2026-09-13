import type { Definition } from '../../web-idl/index';
import {
  mathMLElementIDL, mathMLElementIncludesElementCSSInlineStyleIDL,
} from './element';

export const mathMLIDLDefinitions: Definition[] = [
  mathMLElementIDL,
  mathMLElementIncludesElementCSSInlineStyleIDL,
];
