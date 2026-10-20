import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Suggestion-list identity used by select option traversal. */
// https://html.spec.whatwg.org/multipage/form-elements.html#the-datalist-element
export class HTMLDataListElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLDatalist;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing,
    ];
  }
}

/*
 * [Exposed=Window]
 * interface HTMLDataListElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [SameObject] readonly attribute HTMLCollection options;
 * };
 */
export const htmlDataListElementIDL = defineInterface({
  name: 'HTMLDataListElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLDataListElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['datalist'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
