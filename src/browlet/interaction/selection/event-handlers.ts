import { definePartialInterfaceMixin } from '../../../web-idl/core/index';

import { eventHandlerMapAttr } from '../../scripting/index';

/** Selection's contribution to each GlobalEventHandlers includer's supported names. */
// https://w3c.github.io/selection-api/#extensions-to-globaleventhandlers-interface
// SPEC_CLASH(selection-svg-content-handlers): follow Chromium/WebKit and our shared
// GlobalEventHandlers model; Firefox exposes these SVG properties but ignores their attributes.
// SPEC_CLASH(selection-body-content-handler): keep the body's onselectionchange attribute
// local, following the draft/Firefox. Chromium/WebKit redirect only that attribute to Document.
export const selectionGlobalEventHandlers = new Map<string, string>([
  ['onselectstart', 'selectstart'], ['onselectionchange', 'selectionchange'],
]);

/*
 * partial interface mixin GlobalEventHandlers {
 *   attribute EventHandler onselectstart;
 *   attribute EventHandler onselectionchange;
 * };
 */
export const selectionGlobalEventHandlersIDL = definePartialInterfaceMixin({
  name: 'GlobalEventHandlers',
  members: Array.from(selectionGlobalEventHandlers, ([name]) => eventHandlerMapAttr(name)),
});
