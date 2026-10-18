import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** Division element identity. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#htmldivelement
export class HTMLDivElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLDiv;
    this.prototype.categories = [ContentCategory.Flow, ContentCategory.Palpable];
    this.prototype.contentAttributes = [];
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
