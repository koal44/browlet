import type { BrowletEnvironment } from '../scripting/index';
import type { Definition } from '../../web-idl/index';
import { abortControllerIDL, abortSignalIDL } from './abort/index';
import {
  addEventListenerOptionsIDL, eventListenerIDL, eventListenerOptionsIDL, eventTargetIDL, customEventIDL,
  customEventInitIDL, eventIDL, eventInitIDL,
} from './events/index';
import {
  characterDataIDL, characterDataIncludesChildNodeIDL, characterDataIncludesNonDocumentTypeChildNodeIDL,
  attrIDL, namedNodeMapIDL, htmlCollectionIDL, commentIDL, documentFragmentIDL,
  documentFragmentIncludesParentNodeIDL, documentIDL, documentIncludesDocumentOrShadowRootIDL,
  documentIncludesParentNodeIDL, elementCreationOptionsIDL, documentTypeIDL,
  documentTypeIncludesChildNodeIDL, elementIDL, elementIncludesChildNodeIDL,
  elementIncludesNonDocumentTypeChildNodeIDL, elementIncludesParentNodeIDL, getRootNodeOptionsIDL, nodeIDL,
  childNodeIDL, documentOrShadowRootIDL, nonDocumentTypeChildNodeIDL, parentNodeIDL, shadowRootIDL,
  shadowRootIncludesDocumentOrShadowRootIDL, shadowRootModeIDL, slotAssignmentModeIDL, textIDL,
} from './nodes/index';

export const domIDLDefinitions: Definition<BrowletEnvironment>[] = [
  eventIDL,
  eventInitIDL,
  customEventIDL,
  customEventInitIDL,
  eventTargetIDL,
  eventListenerIDL,
  eventListenerOptionsIDL,
  addEventListenerOptionsIDL,
  abortSignalIDL,
  abortControllerIDL,

  parentNodeIDL,
  documentOrShadowRootIDL,
  childNodeIDL,
  nonDocumentTypeChildNodeIDL,
  nodeIDL,
  getRootNodeOptionsIDL,
  htmlCollectionIDL,
  namedNodeMapIDL,
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

  documentIDL,
  elementCreationOptionsIDL,
  documentIncludesParentNodeIDL,
  documentIncludesDocumentOrShadowRootIDL,
  elementIDL,
  elementIncludesParentNodeIDL,
  elementIncludesChildNodeIDL,
  elementIncludesNonDocumentTypeChildNodeIDL,
];
