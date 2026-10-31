import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Time element identity. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#htmltimeelement
export class HTMLTimeElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLTime;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }

  /** The datetime attribute when present, otherwise direct child text; no date parsing or normalization. */
  // https://html.spec.whatwg.org/multipage/text-level-semantics.html#datetime-value
  getDatetimeValue(): string {
    return this.getAttributeNS(null, 'datetime') ?? this.getChildTextContent();
  }

  /** Use this element's datetime value for a string-valued Microdata property. */
  protected override getMicrodataStringValue(): string {
    return this.getDatetimeValue();
  }
}

/*
 * [Exposed=Window]
 * interface HTMLTimeElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString dateTime;
 * };
 */
export const htmlTimeElementIDL = defineInterface({
  name: 'HTMLTimeElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLTimeElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['time'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
