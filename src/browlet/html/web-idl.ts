import type { Definition } from '../../web-idl/declaration/index';
import {
  htmlElementIDL, htmlElementIncludesElementCSSInlineStyleIDL,
} from './elements/html-element';
import { htmlUnknownElementIDL } from './elements/html-unknown-element';
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
  htmlUnknownElementIDL,
  htmlHeadElementIDL,
  htmlStyleElementIDL,
  htmlStyleElementIncludesLinkStyleIDL,
  htmlLinkElementIDL,
  htmlLinkElementIncludesLinkStyleIDL,
];
