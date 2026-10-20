import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory, phrasingContent } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Span element identity. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#htmlspanelement
export class HTMLSpanElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLSpan;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
    this.prototype.contentModel = { childRules: [phrasingContent] };
  }
}

/*
 * [Exposed=Window]
 * interface HTMLSpanElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 * };
 */
export const htmlSpanElementIDL = defineInterface({
  name: 'HTMLSpanElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLSpanElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['span'],
  members: [ctor([], xattr('HTMLConstructor'))],
});
