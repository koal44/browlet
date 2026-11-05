import { definePartialInterface, nullable, op, reference } from '../../../web-idl/core/index';

import { getComposedRangesOptionsIDL, selectionIDL } from './selection';
import { selectionGlobalEventHandlersIDL } from './event-handlers';

/*
 * partial interface Document {
 *   Selection? getSelection();
 * };
 */
export const documentSelectionIDL = definePartialInterface({
  name: 'Document', members: [op('getSelection', nullable(reference('Selection')))],
});

/*
 * partial interface Window {
 *   Selection? getSelection();
 * };
 */
export const windowSelectionIDL = definePartialInterface({
  name: 'Window', members: [op('getSelection', nullable(reference('Selection')))],
});

export const selectionIDLDefinitions = [
  selectionIDL, getComposedRangesOptionsIDL, documentSelectionIDL, windowSelectionIDL, selectionGlobalEventHandlersIDL,
];
