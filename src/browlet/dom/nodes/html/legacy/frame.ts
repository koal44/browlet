import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag } from '../../element-definitions/index';
import type { Navigable } from '../../../../browsing/navigation/index';

import { HTMLElementImpl } from '../html-element';

/** Legacy frame identity and retained child-navigation state. */
// https://html.spec.whatwg.org/multipage/obsolete.html#frame
export class HTMLFrameElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLFrame;
    this.prototype.isAllNamedElement = true;
  }

  /** Retained child destination; the accessor keeps its reverse container link in sync. */
  #contentNavigable: Navigable | null = null;

  /** Child navigation destination, or null before creation and after destruction. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#content-navigable
  // TODO(HTML legacy frames): create/destroy the child and maintain this association.
  get contentNavigable(): Navigable | null {
    return this.#contentNavigable;
  }

  set contentNavigable(value: Navigable | null) {
    if (this.#contentNavigable === value) return;
    const previous = this.#contentNavigable;
    this.#contentNavigable = value;
    previous?.setContainer(null);
    value?.setContainer(this);
  }
}

/*
 * [Exposed=Window]
 * interface HTMLFrameElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString name;
 *   [CEReactions, Reflect] attribute DOMString scrolling;
 *   [CEReactions, ReflectURL] attribute USVString src;
 *   [CEReactions, Reflect] attribute DOMString frameBorder;
 *   [CEReactions, ReflectURL] attribute USVString longDesc;
 *   [CEReactions, Reflect] attribute boolean noResize;
 *   readonly attribute Document? contentDocument;
 *   readonly attribute WindowProxy? contentWindow;
 *
 *   [CEReactions, Reflect] attribute [LegacyNullToEmptyString] DOMString marginHeight;
 *   [CEReactions, Reflect] attribute [LegacyNullToEmptyString] DOMString marginWidth;
 * };
 */
export const htmlFrameElementIDL = defineInterface({
  name: 'HTMLFrameElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLFrameElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['frame'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
