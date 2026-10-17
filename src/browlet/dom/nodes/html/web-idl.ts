import type { Definition } from '../../../../web-idl/index';

import { htmlOrSVGOrMathMLElementIDL } from '../html-or-svg-or-mathml-element';
import {
  htmlElementIDL, htmlElementIncludesElementCSSInlineStyleIDL,
  htmlElementIncludesHTMLOrSVGOrMathMLElementIDL,
} from './html-element';
import { htmlUnknownElementIDL } from './html-unknown-element';
import { htmlScriptElementIDL } from './script';
import { assignedNodesOptionsIDL, htmlSlotElementIDL } from './slot';
import { htmlHtmlElementIDL } from './document/index';
import { htmlBodyElementIDL } from './sections/index';
import { htmlHRElementIDL } from './grouping/index';
import { htmlAnchorElementIDL } from './text/index';
import { htmlFrameElementIDL, htmlFrameSetElementIDL } from './legacy/index';
import {
  htmlHeadElementIDL, htmlTitleElementIDL, htmlBaseElementIDL, htmlLinkElementIDL, htmlLinkElementIncludesLinkStyleIDL,
  htmlStyleElementIDL, htmlStyleElementIncludesLinkStyleIDL, htmlMetaElementIDL,
} from './metadata/index';
import { customElementRegistryIDL, elementInternalsIDL } from './custom-elements/index';
import {
  htmlImageElementIDL, htmlIFrameElementIDL, htmlMediaElementIDL, htmlAudioElementIDL, htmlVideoElementIDL,
  htmlEmbedElementIDL, htmlObjectElementIDL, htmlMapElementIDL, htmlAreaElementIDL,
} from './embedded/index';
import {
  htmlFormElementIDL, htmlInputElementIDL, htmlSelectElementIDL, htmlOptionElementIDL, htmlOptGroupElementIDL,
  htmlFormControlsCollectionIDL, radioNodeListIDL, htmlOptionsCollectionIDL,
  htmlButtonElementIDL, htmlDataListElementIDL, htmlTextAreaElementIDL,
} from './forms/index';
import { htmlDialogElementIDL } from './interactive/index';

export const htmlIDLDefinitions: Definition[] = [
  htmlOrSVGOrMathMLElementIDL,
  customElementRegistryIDL,
  elementInternalsIDL,
  htmlElementIDL,
  htmlElementIncludesElementCSSInlineStyleIDL,
  htmlElementIncludesHTMLOrSVGOrMathMLElementIDL,
  htmlUnknownElementIDL,
  htmlHtmlElementIDL,
  htmlScriptElementIDL,
  htmlSlotElementIDL,
  assignedNodesOptionsIDL,
  htmlHeadElementIDL,
  htmlTitleElementIDL,
  htmlBaseElementIDL,
  htmlMetaElementIDL,
  htmlStyleElementIDL,
  htmlStyleElementIncludesLinkStyleIDL,
  htmlLinkElementIDL,
  htmlLinkElementIncludesLinkStyleIDL,
  htmlBodyElementIDL,
  htmlHRElementIDL,
  htmlAnchorElementIDL,
  htmlImageElementIDL,
  htmlIFrameElementIDL,
  htmlEmbedElementIDL,
  htmlObjectElementIDL,
  htmlMediaElementIDL,
  htmlAudioElementIDL,
  htmlVideoElementIDL,
  htmlMapElementIDL,
  htmlAreaElementIDL,
  htmlFormElementIDL,
  htmlInputElementIDL,
  htmlButtonElementIDL,
  htmlSelectElementIDL,
  htmlOptionElementIDL,
  htmlOptGroupElementIDL,
  htmlDataListElementIDL,
  htmlTextAreaElementIDL,
  htmlFormControlsCollectionIDL,
  radioNodeListIDL,
  htmlOptionsCollectionIDL,
  htmlDialogElementIDL,
  htmlFrameSetElementIDL,
  htmlFrameElementIDL,
];
