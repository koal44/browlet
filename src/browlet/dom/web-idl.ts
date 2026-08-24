import type { Definition } from '../../web-idl/declaration/index';
import {
  cssomDocumentOrShadowRootIDL, elementCSSInlineStyleIDL, linkStyleIDL,
} from '../css-engine';
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
  documentIncludesParentNodeIDL, elementCreationOptionsIDL,
} from './nodes/document';
import {
  documentTypeIDL, documentTypeIncludesChildNodeIDL,
} from './nodes/document-type';
import {
  elementIDL, elementIncludesChildNodeIDL,
  elementIncludesNonDocumentTypeChildNodeIDL, elementIncludesParentNodeIDL,
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
  eventIDL,
  eventInitIDL,
  customEventIDL,
  customEventInitIDL,
  eventTargetIDL,
  eventListenerIDL,
  eventListenerOptionsIDL,
  addEventListenerOptionsIDL,

  parentNodeIDL,
  documentOrShadowRootIDL,
  childNodeIDL,
  nonDocumentTypeChildNodeIDL,
  nodeIDL,
  getRootNodeOptionsIDL,
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
  documentIDL,
  elementCreationOptionsIDL,
  documentIncludesParentNodeIDL,
  documentIncludesDocumentOrShadowRootIDL,
  elementIDL,
  elementIncludesParentNodeIDL,
  elementIncludesChildNodeIDL,
  elementIncludesNonDocumentTypeChildNodeIDL,
];
