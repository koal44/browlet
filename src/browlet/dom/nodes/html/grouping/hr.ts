import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** Thematic-break identity used by select option traversal. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#the-hr-element
export class HTMLHRElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLHr;
    this.prototype.categories = [
      ContentCategory.Flow,
    ];
  }
}

/*
 * [Exposed=Window]
 * interface HTMLHRElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlHRElementIDL = defineInterface({
  name: 'HTMLHRElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLHRElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['hr'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
