import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Media text-track element identity. */
// https://html.spec.whatwg.org/multipage/media.html#htmltrackelement
export class HTMLTrackElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLTrack;
    this.prototype.categories = [];
  }
}

/*
 * [Exposed=Window]
 * interface HTMLTrackElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions] attribute DOMString kind;
 *   [CEReactions, ReflectURL] attribute USVString src;
 *   [CEReactions, Reflect] attribute DOMString srclang;
 *   [CEReactions, Reflect] attribute DOMString label;
 *   [CEReactions, Reflect] attribute boolean default;
 *
 *   const unsigned short NONE = 0;
 *   const unsigned short LOADING = 1;
 *   const unsigned short LOADED = 2;
 *   const unsigned short ERROR = 3;
 *   readonly attribute unsigned short readyState;
 *
 *   readonly attribute TextTrack track;
 * };
 */
export const htmlTrackElementIDL = defineInterface({
  name: 'HTMLTrackElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLTrackElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['track'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
