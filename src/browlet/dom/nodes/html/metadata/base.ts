import { HTML_NAMESPACE } from '../../../../../infra/index';
import {
  attr, ctor, defineInterface, idlType, impl, reflect, reflectSetter, xattr,
} from '../../../../../web-idl/index';
import { serializeURL, type URLRecord } from '../../../../../url/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Supplies the document base URL and default navigation target. */
// https://html.spec.whatwg.org/multipage/semantics.html#the-base-element
export class HTMLBaseElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLBase;
    this.prototype.categories = [
      ContentCategory.Metadata,
    ];
  }

  /** The URL fixed when this becomes the document's first base with href. */
  frozenBaseURL!: URLRecord;

  static is(value: unknown): value is HTMLBaseElementImpl {
    return value instanceof HTMLBaseElementImpl;
  }

  /** Resolves this element's href against the document's fallback base URL. */
  // https://html.spec.whatwg.org/multipage/semantics.html#dom-base-href
  get href(): string {
    const document = this.nodeDocument;
    const href = this.getAttributeNS(null, 'href') ?? '';
    const { env } = document;
    const url = env.parseURL(href, document.getFallbackBaseURL(), document.characterSet).url;
    return url === null ? href : serializeURL(url);
  }

  // https://html.spec.whatwg.org/multipage/semantics.html#set-the-frozen-base-url
  setFrozenBaseURL(): void {
    const document = this.nodeDocument;
    const fallback = document.getFallbackBaseURL();
    const { env } = document;
    const url = env.parseURL(this.getAttributeNS(null, 'href')!, fallback, document.characterSet).url;
    if (url === null || url.scheme === 'data' || url.scheme === 'javascript' ||
      document.policyContainer.cspList?.isBaseBlocked(url, document)) {
      this.frozenBaseURL = fallback;
      return;
    }
    this.frozenBaseURL = url;
    document.respondToBaseURLChanges();
  }

  override attributeChanged(
    localName: string, oldValue: string | null, newValue: string | null,
    namespace: string | null,
  ): void {
    super.attributeChanged(localName, oldValue, newValue, namespace);
    // SPEC_CLASH(base-href-same-value): Follow HTML's change definition and Firefox; Chromium/WebKit refresh on equal values. See ../ROADMAP.md.
    if (namespace === null && localName === 'href' && oldValue !== newValue) {
      this.nodeDocument.updateBaseElement(this);
    }
  }

  protected override insertionSteps(): void {
    super.insertionSteps();
    this.nodeDocument.updateBaseElement();
  }

  protected override removingSteps(): void {
    super.removingSteps();
    this.nodeDocument.updateBaseElement();
  }

  protected override movingSteps(): void {
    // Becoming first in tree order updates the frozen base URL even without reinsertion.
    // https://html.spec.whatwg.org/multipage/semantics.html#frozen-base-url
    this.nodeDocument.updateBaseElement();
  }
}

/*
 * [Exposed=Window]
 * interface HTMLBaseElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectSetter] attribute USVString href;
 *   [CEReactions, Reflect] attribute DOMString target;
 * };
 */
export const htmlBaseElementIDL = defineInterface({
  name: 'HTMLBaseElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLBaseElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['base'],
  members: [
    ctor([], xattr('HTMLConstructor')),
    attr('href', idlType.USVString, xattr('CEReactions', reflectSetter())),
    attr('target', idlType.DOMString, xattr('CEReactions', reflect())),
  ],
});
