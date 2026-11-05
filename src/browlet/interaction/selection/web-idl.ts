import { definePartialInterface, nullable, op, reference } from '../../../web-idl/core/index';

import { getComposedRangesOptionsIDL, selectionIDL } from './selection';

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

// TODO(Selection API §4.3): GlobalEventHandlers' onselectstart/onselectionchange
// declaration contribution and concrete handler fields belong to the next slice.
export const selectionIDLDefinitions = [
  selectionIDL, getComposedRangesOptionsIDL, documentSelectionIDL, windowSelectionIDL,
];
