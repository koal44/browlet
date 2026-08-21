import type { Definition } from '../web-idl/definition';
import { webIDLCommonDefinitions } from '../web-idl/common-definitions';
import {
  cssomDocumentOrShadowRootIDL, elementCSSInlineStyleIDL, linkStyleIDL,
} from './css-engine';
import {
  addEventListenerOptionsIDL, eventListenerIDL, eventListenerOptionsIDL,
  eventTargetIDL,
} from './events/event-target';
import {
  customEventIDL, customEventInitIDL, domHighResTimeStampIDL, eventIDL,
  eventInitIDL,
} from './events/event';
import {
  characterDataIDL, characterDataIncludesChildNodeIDL,
  characterDataIncludesNonDocumentTypeChildNodeIDL,
} from './nodes/character-data';
import { commentIDL } from './nodes/comment';
import {
  documentIDL, documentIncludesDocumentOrShadowRootIDL,
  documentIncludesParentNodeIDL, elementCreationOptionsIDL, htmlDocumentIDL,
} from './nodes/document';
import {
  documentTypeIDL, documentTypeIncludesChildNodeIDL,
} from './nodes/document-type';
import {
  elementIDL, elementIncludesChildNodeIDL,
  elementIncludesNonDocumentTypeChildNodeIDL, elementIncludesParentNodeIDL,
  htmlElementIDL, htmlElementIncludesElementCSSInlineStyleIDL,
  htmlHeadElementIDL, htmlLinkElementIDL,
  htmlLinkElementIncludesLinkStyleIDL, htmlStyleElementIDL,
  htmlStyleElementIncludesLinkStyleIDL, mathMLElementIDL,
  mathMLElementIncludesElementCSSInlineStyleIDL, svgElementIDL,
  svgElementIncludesElementCSSInlineStyleIDL, svgStyleElementIDL,
  svgStyleElementIncludesLinkStyleIDL,
} from './nodes/element';
import {
  childNodeIDL, documentOrShadowRootIDL, getRootNodeOptionsIDL, nodeIDL,
  nonDocumentTypeChildNodeIDL, parentNodeIDL,
} from './nodes/node';
import { textIDL } from './nodes/text';

export const domIDLDefinitions: Definition[] = [
  ...webIDLCommonDefinitions,
  domHighResTimeStampIDL,
  eventListenerIDL,
  eventListenerOptionsIDL,
  addEventListenerOptionsIDL,
  eventInitIDL,
  customEventInitIDL,
  eventIDL,
  customEventIDL,
  eventTargetIDL,

  getRootNodeOptionsIDL,
  parentNodeIDL,
  documentOrShadowRootIDL,
  childNodeIDL,
  nonDocumentTypeChildNodeIDL,
  nodeIDL,
  characterDataIDL,
  characterDataIncludesChildNodeIDL,
  characterDataIncludesNonDocumentTypeChildNodeIDL,
  documentTypeIDL,
  documentTypeIncludesChildNodeIDL,
  textIDL,
  commentIDL,

  elementCSSInlineStyleIDL,
  linkStyleIDL,
  cssomDocumentOrShadowRootIDL,
  elementCreationOptionsIDL,
  documentIDL,
  documentIncludesParentNodeIDL,
  documentIncludesDocumentOrShadowRootIDL,
  htmlDocumentIDL,
  elementIDL,
  elementIncludesParentNodeIDL,
  elementIncludesChildNodeIDL,
  elementIncludesNonDocumentTypeChildNodeIDL,
  htmlElementIDL,
  htmlElementIncludesElementCSSInlineStyleIDL,
  htmlHeadElementIDL,
  htmlStyleElementIDL,
  htmlStyleElementIncludesLinkStyleIDL,
  htmlLinkElementIDL,
  htmlLinkElementIncludesLinkStyleIDL,
  svgElementIDL,
  svgElementIncludesElementCSSInlineStyleIDL,
  svgStyleElementIDL,
  svgStyleElementIncludesLinkStyleIDL,
  mathMLElementIDL,
  mathMLElementIncludesElementCSSInlineStyleIDL,
];
