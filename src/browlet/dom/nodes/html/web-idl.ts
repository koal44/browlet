import type { Definition } from '../../../../web-idl/index';

import { htmlOrSVGOrMathMLElementIDL } from '../html-or-svg-or-mathml-element';
import {
  htmlElementIDL, htmlElementIncludesElementCSSInlineStyleIDL,
  htmlElementIncludesHTMLOrSVGOrMathMLElementIDL,
} from './html-element';
import { htmlUnknownElementIDL } from './html-unknown-element';
import { htmlScriptElementIDL } from './script';
import { assignedNodesOptionsIDL, htmlSlotElementIDL } from './slot';
import {
  htmlHeadElementIDL, htmlBaseElementIDL, htmlLinkElementIDL, htmlLinkElementIncludesLinkStyleIDL,
  htmlStyleElementIDL, htmlStyleElementIncludesLinkStyleIDL,
} from './metadata/index';
import { customElementRegistryIDL, elementInternalsIDL } from './custom-elements/index';
import {
  htmlImageElementIDL, htmlIFrameElementIDL, htmlMediaElementIDL, htmlAudioElementIDL, htmlVideoElementIDL,
} from './embedded/index';
import {
  htmlFormElementIDL, htmlInputElementIDL, htmlSelectElementIDL, htmlOptionElementIDL, htmlOptGroupElementIDL,
  htmlFormControlsCollectionIDL, radioNodeListIDL, htmlOptionsCollectionIDL,
} from './forms/index';

export const htmlIDLDefinitions: Definition[] = [
  htmlOrSVGOrMathMLElementIDL,
  customElementRegistryIDL,
  elementInternalsIDL,
  htmlElementIDL,
  htmlElementIncludesElementCSSInlineStyleIDL,
  htmlElementIncludesHTMLOrSVGOrMathMLElementIDL,
  htmlUnknownElementIDL,
  htmlScriptElementIDL,
  htmlSlotElementIDL,
  assignedNodesOptionsIDL,
  htmlHeadElementIDL,
  htmlBaseElementIDL,
  htmlStyleElementIDL,
  htmlStyleElementIncludesLinkStyleIDL,
  htmlLinkElementIDL,
  htmlLinkElementIncludesLinkStyleIDL,
  htmlImageElementIDL,
  htmlIFrameElementIDL,
  htmlMediaElementIDL,
  htmlAudioElementIDL,
  htmlVideoElementIDL,
  htmlFormElementIDL,
  htmlInputElementIDL,
  htmlSelectElementIDL,
  htmlOptionElementIDL,
  htmlOptGroupElementIDL,
  htmlFormControlsCollectionIDL,
  radioNodeListIDL,
  htmlOptionsCollectionIDL,
];
