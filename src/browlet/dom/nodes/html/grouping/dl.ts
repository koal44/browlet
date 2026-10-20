import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Description-list element identity. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#htmldlistelement
export class HTMLDListElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLDl;
    this.prototype.categories = [
      ContentCategory.Flow,
    ];
  }

  override hasCategory(category: ContentCategory): boolean {
    if (category === ContentCategory.Palpable) return this.hasNameValueGroup();
    return super.hasCategory(category);
  }

  /** Whether the grouping algorithm produces a group, including one with missing names or values. */
  // https://html.spec.whatwg.org/multipage/grouping-content.html#the-dl-element
  hasNameValueGroup(): boolean {
    for (let child = this.firstElementChild; child !== null; child = child.nextElementSibling) {
      if (child.tag === ElementTag.HTMLDt || child.tag === ElementTag.HTMLDd) return true;
      if (child.tag === ElementTag.HTMLDiv) {
        for (let grandchild = child.firstElementChild; grandchild !== null; grandchild = grandchild.nextElementSibling) {
          if (grandchild.tag === ElementTag.HTMLDt || grandchild.tag === ElementTag.HTMLDd) return true;
        }
      }
    }
    return false;
  }
}

/*
 * [Exposed=Window]
 * interface HTMLDListElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlDListElementIDL = defineInterface({
  name: 'HTMLDListElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLDListElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['dl'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
