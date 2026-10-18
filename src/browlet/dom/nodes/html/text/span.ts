import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** Span element identity. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#htmlspanelement
export class HTMLSpanElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLSpan;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
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
