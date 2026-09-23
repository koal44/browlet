import { HTML_NAMESPACE } from '../../../../infra/index';
import { serializeURL, type URLRecord } from '../../../../url/index';
import { attr, defineInterface, idlType, impl, xattr } from '../../../../web-idl/index';
import { defineElementInterface } from '../../../dom/nodes/element';
import { HTMLElementImpl } from '../html-element';

/*
 * [Exposed=Window]
 * interface HTMLBaseElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectSetter] attribute USVString href;
 *   [CEReactions, Reflect] attribute DOMString target;
 * };
 */
export class HTMLBaseElementImpl extends HTMLElementImpl {
  /** The URL fixed when this becomes the document's first base with href. */
  frozenBaseURL!: URLRecord;

  /** Resolves this element's href against the document's fallback base URL. */
  // https://html.spec.whatwg.org/multipage/semantics.html#dom-base-href
  get href(): string {
    const document = this.getNodeDocument()!;
    const href = this.getAttributeNS(null, 'href') ?? '';
    const { env } = document;
    const url = env.parseURL(href, document.getFallbackBaseURL(), document.characterSet).url;
    return url === null ? href : serializeURL(url);
  }

  set href(value: string) {
    this.setAttributeValue('href', value);
  }

  /** The reflected default navigation target name. */
  get target(): string {
    return this.getAttributeNS(null, 'target') ?? '';
  }

  set target(value: string) {
    this.setAttributeValue('target', value);
  }

  // -- Internal ---------------------------------------------------------

  // https://html.spec.whatwg.org/multipage/semantics.html#set-the-frozen-base-url
  setFrozenBaseURL(): void {
    const document = this.getNodeDocument()!;
    const fallback = document.getFallbackBaseURL();
    const { env } = document;
    const url = env.parseURL(this.getAttributeNS(null, 'href')!, fallback, document.characterSet).url;
    // TODO: apply CSP's "Is base allowed for Document?" check when CSP is implemented.
    this.frozenBaseURL = url === null || url.scheme === 'data' || url.scheme === 'javascript'
      ? fallback : url;
    // Base-change consumers (hyperlink state and speculation rules) await their subsystems.
  }

  override attributeChanged(
    localName: string, oldValue: string | null, newValue: string | null,
    namespace: string | null,
  ): void {
    super.attributeChanged(localName, oldValue, newValue, namespace);
    if (namespace === null && localName === 'href') {
      this.getNodeDocument()!.updateBaseElement(this);
    }
  }

  protected override insertedInto(): void {
    super.insertedInto();
    this.getNodeDocument()!.updateBaseElement();
  }

  protected override removedFrom(): void {
    super.removedFrom();
    this.getNodeDocument()!.updateBaseElement();
  }
}

// -- Web IDL ------------------------------------------------------------

export const htmlBaseElementIDL = defineInterface({
  name: 'HTMLBaseElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLBaseElementImpl),
  members: [
    attr('href', idlType.USVString, xattr('CEReactions', 'ReflectSetter')),
    attr('target', idlType.DOMString, xattr('CEReactions', 'Reflect')),
  ],
});

export const htmlBaseElementInterface = defineElementInterface({
  definition: htmlBaseElementIDL,
  localNames: ['base'],
  namespaceURI: HTML_NAMESPACE,
});
