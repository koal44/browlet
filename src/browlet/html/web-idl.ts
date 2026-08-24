import type { Definition } from '../../web-idl/declaration/index';
import {
  htmlElementIDL, htmlElementIncludesElementCSSInlineStyleIDL,
} from './elements/html-element';
import { htmlHeadElementIDL } from './elements/metadata/head';
import {
  htmlLinkElementIDL, htmlLinkElementIncludesLinkStyleIDL,
} from './elements/metadata/link';
import {
  htmlStyleElementIDL, htmlStyleElementIncludesLinkStyleIDL,
} from './elements/metadata/style';

export const htmlIDLDefinitions: Definition[] = [
  htmlElementIDL,
  htmlElementIncludesElementCSSInlineStyleIDL,
  htmlHeadElementIDL,
  htmlStyleElementIDL,
  htmlStyleElementIncludesLinkStyleIDL,
  htmlLinkElementIDL,
  htmlLinkElementIncludesLinkStyleIDL,
];
