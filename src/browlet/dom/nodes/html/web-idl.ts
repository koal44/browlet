import type { Definition } from '../../../../web-idl/index';

import { htmlOrSVGOrMathMLElementIDL } from '../html-or-svg-or-mathml-element';
import {
  htmlElementIDL, htmlElementIncludesElementCSSInlineStyleIDL,
  htmlElementIncludesHTMLOrSVGOrMathMLElementIDL, showPopoverOptionsIDL, togglePopoverOptionsIDL,
} from './html-element-definition';
import { htmlUnknownElementIDL } from './html-unknown-element';
import { htmlScriptElementIDL } from './script';
import { assignedNodesOptionsIDL, htmlSlotElementIDL } from './slot';
import { htmlHtmlElementIDL } from './document/index';
import { htmlBodyElementIDL, htmlHeadingElementIDL } from './sections/index';
import {
  htmlParagraphElementIDL, htmlHRElementIDL, htmlPreElementIDL, htmlOListElementIDL, htmlUListElementIDL,
  htmlMenuElementIDL, htmlLIElementIDL, htmlDListElementIDL, htmlDivElementIDL, htmlQuoteElementIDL,
} from './grouping/index';
import {
  htmlAnchorElementIDL, htmlDataElementIDL, htmlTimeElementIDL,
  htmlSpanElementIDL, htmlBRElementIDL, htmlModElementIDL,
} from './text/index';
import {
  htmlFrameElementIDL, htmlFrameSetElementIDL, htmlDirectoryElementIDL,
  htmlFontElementIDL, htmlMarqueeElementIDL, htmlParamElementIDL,
} from './legacy/index';
import {
  htmlHeadElementIDL, htmlTitleElementIDL, htmlBaseElementIDL, htmlLinkElementIDL, htmlLinkElementIncludesLinkStyleIDL,
  htmlStyleElementIDL, htmlStyleElementIncludesLinkStyleIDL, htmlMetaElementIDL,
} from './metadata/index';
import { customElementRegistryIDL, elementInternalsIDL } from './custom-elements/index';
import {
  htmlImageElementIDL, htmlIFrameElementIDL, htmlMediaElementIDL, htmlAudioElementIDL, htmlVideoElementIDL,
  htmlEmbedElementIDL, htmlObjectElementIDL, htmlMapElementIDL, htmlAreaElementIDL,
  htmlPictureElementIDL, htmlSourceElementIDL, htmlTrackElementIDL,
} from './embedded/index';
import {
  htmlTableElementIDL, htmlTableCaptionElementIDL, htmlTableColElementIDL,
  htmlTableSectionElementIDL, htmlTableRowElementIDL, htmlTableCellElementIDL,
} from './tables/index';
import {
  htmlFormElementIDL, htmlInputElementIDL, htmlSelectElementIDL, htmlOptionElementIDL, htmlOptGroupElementIDL,
  htmlFormControlsCollectionIDL, radioNodeListIDL, htmlOptionsCollectionIDL,
  htmlButtonElementIDL, htmlDataListElementIDL, htmlTextAreaElementIDL,
  htmlLabelElementIDL, htmlOutputElementIDL, htmlProgressElementIDL, htmlMeterElementIDL,
  htmlFieldSetElementIDL, htmlLegendElementIDL, htmlSelectedContentElementIDL,
} from './forms/index';
import { htmlDetailsElementIDL, htmlDialogElementIDL } from './interactive/index';
import { htmlCanvasElementIDL, htmlTemplateElementIDL } from './scripting/index';

export const htmlIDLDefinitions: Definition[] = [
  htmlOrSVGOrMathMLElementIDL,
  customElementRegistryIDL,
  elementInternalsIDL,
  htmlElementIDL,
  htmlElementIncludesElementCSSInlineStyleIDL,
  htmlElementIncludesHTMLOrSVGOrMathMLElementIDL,
  showPopoverOptionsIDL,
  togglePopoverOptionsIDL,
  htmlUnknownElementIDL,
  htmlHtmlElementIDL,
  htmlScriptElementIDL,
  htmlSlotElementIDL,
  assignedNodesOptionsIDL,
  htmlTemplateElementIDL,
  htmlCanvasElementIDL,
  htmlHeadElementIDL,
  htmlTitleElementIDL,
  htmlBaseElementIDL,
  htmlMetaElementIDL,
  htmlStyleElementIDL,
  htmlStyleElementIncludesLinkStyleIDL,
  htmlLinkElementIDL,
  htmlLinkElementIncludesLinkStyleIDL,
  htmlBodyElementIDL,
  htmlHeadingElementIDL,
  htmlParagraphElementIDL,
  htmlHRElementIDL,
  htmlPreElementIDL,
  htmlOListElementIDL,
  htmlUListElementIDL,
  htmlMenuElementIDL,
  htmlLIElementIDL,
  htmlDListElementIDL,
  htmlDivElementIDL,
  htmlAnchorElementIDL,
  htmlQuoteElementIDL,
  htmlDataElementIDL,
  htmlTimeElementIDL,
  htmlSpanElementIDL,
  htmlBRElementIDL,
  htmlModElementIDL,
  htmlPictureElementIDL,
  htmlSourceElementIDL,
  htmlImageElementIDL,
  htmlIFrameElementIDL,
  htmlEmbedElementIDL,
  htmlObjectElementIDL,
  htmlMediaElementIDL,
  htmlAudioElementIDL,
  htmlVideoElementIDL,
  htmlTrackElementIDL,
  htmlMapElementIDL,
  htmlAreaElementIDL,
  htmlTableElementIDL,
  htmlTableCaptionElementIDL,
  htmlTableColElementIDL,
  htmlTableSectionElementIDL,
  htmlTableRowElementIDL,
  htmlTableCellElementIDL,
  htmlFormElementIDL,
  htmlLabelElementIDL,
  htmlInputElementIDL,
  htmlButtonElementIDL,
  htmlSelectElementIDL,
  htmlOptionElementIDL,
  htmlOptGroupElementIDL,
  htmlDataListElementIDL,
  htmlTextAreaElementIDL,
  htmlOutputElementIDL,
  htmlProgressElementIDL,
  htmlMeterElementIDL,
  htmlFieldSetElementIDL,
  htmlLegendElementIDL,
  htmlSelectedContentElementIDL,
  htmlFormControlsCollectionIDL,
  radioNodeListIDL,
  htmlOptionsCollectionIDL,
  htmlDetailsElementIDL,
  htmlDialogElementIDL,
  htmlFrameSetElementIDL,
  htmlFrameElementIDL,
  htmlDirectoryElementIDL,
  htmlFontElementIDL,
  htmlMarqueeElementIDL,
  htmlParamElementIDL,
];
