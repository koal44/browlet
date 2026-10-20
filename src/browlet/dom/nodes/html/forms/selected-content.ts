import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Selected-option content element identity. */
// https://html.spec.whatwg.org/multipage/form-elements.html#htmlselectedcontentelement
export class HTMLSelectedContentElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLSelectedcontent;
    this.prototype.categories = [];
  }

  override hasCategory(category: ContentCategory): boolean {
    // The phrasing list names selectedcontent; the flow list omits it. §3.2.5.2 explicitly includes phrasing in flow.
    // https://html.spec.whatwg.org/multipage/dom.html#kinds-of-content
    if (category === ContentCategory.Flow || category === ContentCategory.Phrasing) {
      for (let ancestor = this.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
        if (ancestor.tag === ElementTag.HTMLButton && ancestor.parentElement?.tag === ElementTag.HTMLSelect) return true;
      }
      return false;
    }
    return super.hasCategory(category);
  }
}

/*
 * [Exposed=Window]
 * interface HTMLSelectedContentElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 * };
 */
export const htmlSelectedContentElementIDL = defineInterface({
  name: 'HTMLSelectedContentElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLSelectedContentElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['selectedcontent'],
  members: [ctor([], xattr('HTMLConstructor'))],
});
