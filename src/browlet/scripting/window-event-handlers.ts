import { defineInterfaceMixin } from '../../web-idl/core/index';

import { eventHandlerMapAttr } from './event-handlers';

/** Window-owned handlers, also exposed by body and frameset through target resolution. */
// https://html.spec.whatwg.org/multipage/webappapis.html#windoweventhandlers
export const windowEventHandlers = new Map<string, string>([
  'afterprint', 'beforeprint', 'beforeunload', 'hashchange', 'languagechange', 'message', 'messageerror', 'offline', 'online',
  'pagehide', 'pagereveal', 'pageshow', 'pageswap', 'popstate', 'rejectionhandled', 'storage',
  'unhandledrejection', 'unload',
].map((type) => [`on${type}`, type]));

/*
 * interface mixin WindowEventHandlers {
 *   attribute EventHandler onafterprint;
 *   attribute EventHandler onbeforeprint;
 *   attribute OnBeforeUnloadEventHandler onbeforeunload;
 *   attribute EventHandler onhashchange;
 *   attribute EventHandler onlanguagechange;
 *   attribute EventHandler onmessage;
 *   attribute EventHandler onmessageerror;
 *   attribute EventHandler onoffline;
 *   attribute EventHandler ononline;
 *   attribute EventHandler onpagehide;
 *   attribute EventHandler onpagereveal;
 *   attribute EventHandler onpageshow;
 *   attribute EventHandler onpageswap;
 *   attribute EventHandler onpopstate;
 *   attribute EventHandler onrejectionhandled;
 *   attribute EventHandler onstorage;
 *   attribute EventHandler onunhandledrejection;
 *   attribute EventHandler onunload;
 * };
 */
export const windowEventHandlersIDL = defineInterfaceMixin({
  name: 'WindowEventHandlers',
  members: Array.from(windowEventHandlers, ([name]) =>
    eventHandlerMapAttr(name, name === 'onbeforeunload' ? 'OnBeforeUnloadEventHandler' : 'EventHandler')),
});
