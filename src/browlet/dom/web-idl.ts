import type { Definition } from '../../web-idl/index';
import type { Realm } from '../scripting/realm';
import { abortControllerIDL } from './abort/abort-controller';
import { abortSignalIDL } from './abort/abort-signal';
import {
  addEventListenerOptionsIDL, eventListenerIDL, eventListenerOptionsIDL,
  eventTargetIDL,
} from './events/event-target';
import {
  customEventIDL, customEventInitIDL, eventIDL, eventInitIDL,
} from './events/event';
import {
  progressEventIDL, progressEventInitIDL,
} from './events/progress-event';
import {
  characterDataIDL, characterDataIncludesChildNodeIDL,
  characterDataIncludesNonDocumentTypeChildNodeIDL,
} from './nodes/character-data';
import { attrIDL } from './nodes/attribute';
import { namedNodeMapIDL } from './nodes/named-node-map';
import { htmlCollectionIDL } from './nodes/collections';
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
  getRootNodeOptionsIDL, nodeIDL,
} from './nodes/node';
import { childNodeIDL } from './nodes/child-node';
import { documentOrShadowRootIDL } from './nodes/document-or-shadow-root';
import { nonDocumentTypeChildNodeIDL } from './nodes/non-document-type-child-node';
import { parentNodeIDL } from './nodes/parent-node';
import {
  shadowRootIDL, shadowRootIncludesDocumentOrShadowRootIDL,
  shadowRootModeIDL, slotAssignmentModeIDL,
} from './nodes/shadow-root';
import { textIDL } from './nodes/text';

export const domIDLDefinitions: Definition<Realm>[] = [
  eventIDL,
  eventInitIDL,
  customEventIDL,
  customEventInitIDL,
  progressEventIDL,
  progressEventInitIDL,
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
