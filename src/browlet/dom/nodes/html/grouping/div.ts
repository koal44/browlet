import { HTML_NAMESPACE } from '../../../../../infra/index';
import { InternalError } from '../../../../../infra/internal-error';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import {
  ElementTag, ContentCategory, flowContent, transparentContent, type ContentModel,
} from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Division element identity. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#htmldivelement
export class HTMLDivElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLDiv;
    this.prototype.categories = [ContentCategory.Flow, ContentCategory.Palpable];
    this.prototype.contentModel = { childRules: [flowContent] };
    this.prototype.contentAttributes = [];
  }

  // https://html.spec.whatwg.org/multipage/grouping-content.html#the-div-element
  override getContentModel(): ContentModel {
    if (this.parentElement?.tag === ElementTag.HTMLDl) {
      // TODO: The dt/dd groups with interspersed script-supporting elements belong to §4.4.
      throw new InternalError('The div content model inside dl is not implemented');
    }
    for (let ancestor = this.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
      if (ancestor.tag === ElementTag.HTMLOption || ancestor.tag === ElementTag.HTMLOptgroup ||
        ancestor.tag === ElementTag.HTMLSelect) return { childRules: [transparentContent] };
    }
    return super.getContentModel();
  }
}

/*
 * [Exposed=Window]
 * interface HTMLDivElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlDivElementIDL = defineInterface({
  name: 'HTMLDivElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLDivElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['div'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
