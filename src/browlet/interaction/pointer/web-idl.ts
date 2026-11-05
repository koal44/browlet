import { definePartialInterface, idlType, roAttr } from '../../../web-idl/core/index';

/*
 * partial interface Navigator {
 *   readonly attribute long maxTouchPoints;
 * };
 */
// https://w3c.github.io/pointerevents/#extensions-to-the-navigator-interface
export const navigatorPointerEventsIDL = definePartialInterface({
  name: 'Navigator',
  members: [roAttr('maxTouchPoints', idlType.long)],
});
