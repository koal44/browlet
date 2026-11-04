import { definePartialInterfaceMixin, xattr } from '../../../web-idl/core/index';

import { eventHandlerMapAttr } from '../../scripting/index';

/** Pointer Events' contribution to each GlobalEventHandlers includer's supported names. */
// https://w3c.github.io/pointerevents/#extensions-to-the-globaleventhandlers-mixin
// Content attributes remain supported in insecure contexts; SecureContext controls
// IDL property exposure, while native raw delivery has its own secure-context gate.
export const pointerEventHandlers = new Map<string, string>([
  'pointerover', 'pointerenter', 'pointerdown', 'pointermove', 'pointerrawupdate',
  'pointerup', 'pointercancel', 'pointerout', 'pointerleave', 'gotpointercapture', 'lostpointercapture',
].map((type) => [`on${type}`, type]));

/*
 * partial interface mixin GlobalEventHandlers {
 *   attribute EventHandler onpointerover;
 *   attribute EventHandler onpointerenter;
 *   attribute EventHandler onpointerdown;
 *   attribute EventHandler onpointermove;
 *   [SecureContext] attribute EventHandler onpointerrawupdate;
 *   attribute EventHandler onpointerup;
 *   attribute EventHandler onpointercancel;
 *   attribute EventHandler onpointerout;
 *   attribute EventHandler onpointerleave;
 *   attribute EventHandler ongotpointercapture;
 *   attribute EventHandler onlostpointercapture;
 * };
 */
export const pointerGlobalEventHandlersIDL = definePartialInterfaceMixin({
  name: 'GlobalEventHandlers',
  members: Array.from(pointerEventHandlers, ([name]) => ({
    ...eventHandlerMapAttr(name),
    // SPEC_CLASH(pointer-rawupdate-handler-exposure): Follow the draft/Chromium/Firefox; WebKit implements neither the property nor the content handler.
    ...(name === 'onpointerrawupdate' ? xattr('SecureContext') : {}),
  })),
});
