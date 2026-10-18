import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

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
