import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** Unordered-list element identity. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#htmlulistelement
export class HTMLUListElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLUl;
    this.prototype.categories = [
      ContentCategory.Flow,
    ];
  }

  override hasCategory(category: ContentCategory): boolean {
    if (category === ContentCategory.Palpable) {
      for (let child = this.firstElementChild; child !== null; child = child.nextElementSibling) {
        if (child.tag === ElementTag.HTMLLi) return true;
      }
      return false;
    }
    return super.hasCategory(category);
  }
}

/*
 * [Exposed=Window]
 * interface HTMLUListElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlUListElementIDL = defineInterface({
  name: 'HTMLUListElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLUListElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['ul'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
