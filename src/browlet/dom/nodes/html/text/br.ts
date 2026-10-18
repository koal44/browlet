import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** Line-break element identity. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#htmlbrelement
export class HTMLBRElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLBr;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing,
    ];
  }
}

/*
 * [Exposed=Window]
 * interface HTMLBRElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlBRElementIDL = defineInterface({
  name: 'HTMLBRElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLBRElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['br'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
