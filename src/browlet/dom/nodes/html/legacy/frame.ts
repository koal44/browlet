import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, nullable, reference, roAttr, xattr } from '../../../../../web-idl/core/index';
import { areSameOriginDomain } from '../../../../../url/index';
import { DeferredFetchQuota } from '../../../../../fetch/index';

import { ElementTag } from '../../element-definitions/index';
import type { WindowProxyHandle } from '../../../../browsing/window/index';
import type { Navigable } from '../../../../browsing/navigation/index';

import type { DocumentImpl } from '../../document';
import { HTMLElementImpl } from '../html-element';

/** Legacy frame identity and retained child-navigation state. */
// https://html.spec.whatwg.org/multipage/obsolete.html#frame
export class HTMLFrameElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLFrame;
    this.prototype.isAllNamedElement = true;
  }

  /** Quota delegated to this container by its node Document's navigation. */
  // https://fetch.spec.whatwg.org/#reserved-deferred-fetch-quota
  reservedDeferredFetchQuota: number = DeferredFetchQuota.None;
  /** Retained child destination; the accessor keeps its reverse container link in sync. */
  #contentNavigable: Navigable | null = null;

  /** Child navigation destination, or null before creation and after destruction. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#content-navigable
  // TODO(HTML legacy frames): Insertion/removal must call the node Document's user agent to create/destroy its child.
  // Frame context inheritance, recursive Document teardown, and history application remain unfinished.
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

  /** Active child Document when it shares this container's node Document origin-domain. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#concept-bcc-content-document
  get contentDocument(): DocumentImpl | null {
    const document = this.#contentNavigable?.activeDocument ?? null;
    return document !== null && areSameOriginDomain(document.origin, this.nodeDocument.origin) ? document : null;
  }

  /** Active child's WindowProxy, including for a cross-origin child. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#content-window
  get contentWindow(): WindowProxyHandle | null {
    return this.#contentNavigable?.activeWindowProxy ?? null;
  }

  protected override insertionSteps(): void {
    this.nodeDocument.recordNavigableContainerInsertion(this);
    super.insertionSteps();
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
    roAttr('contentDocument', nullable(reference('Document'))),
    roAttr('contentWindow', nullable(reference('WindowProxy'))),
  ],
});
