import type { Definition } from '../web-idl/definition';
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
import { attrIDL } from './nodes/attribute';
import { commentIDL } from './nodes/comment';
import {
  documentFragmentIDL, documentFragmentIncludesParentNodeIDL,
} from './nodes/document-fragment';
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
import {
  shadowRootIDL, shadowRootIncludesDocumentOrShadowRootIDL,
  shadowRootModeIDL, slotAssignmentModeIDL,
} from './nodes/shadow-root';
import { textIDL } from './nodes/text';

export const domIDLDefinitions: Definition[] = [
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
  attrIDL,
  characterDataIDL,
  characterDataIncludesChildNodeIDL,
  characterDataIncludesNonDocumentTypeChildNodeIDL,
  documentTypeIDL,
  documentTypeIncludesChildNodeIDL,
  textIDL,
  commentIDL,
  documentFragmentIDL,
  documentFragmentIncludesParentNodeIDL,
  shadowRootModeIDL,
  slotAssignmentModeIDL,
  shadowRootIDL,
  shadowRootIncludesDocumentOrShadowRootIDL,

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
