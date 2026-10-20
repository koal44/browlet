import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory, flowContent, phrasingContent } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The blockquote element, exposed through HTMLQuoteElement. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#the-blockquote-element
export class HTMLBlockQuoteElementImpl extends HTMLElementImpl {
  static override localName = 'blockquote';
  static {
    this.prototype.tag = ElementTag.HTMLBlockquote;
    this.prototype.categories = [ContentCategory.Flow, ContentCategory.Palpable];
    this.prototype.contentModel = { childRules: [flowContent] };
    this.prototype.contentAttributes = ['cite'];
  }
}

/** The q element, exposed through HTMLQuoteElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-q-element
export class HTMLQElementImpl extends HTMLElementImpl {
  static override localName = 'q';
  static {
    this.prototype.tag = ElementTag.HTMLQ;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
    this.prototype.contentModel = { childRules: [phrasingContent] };
    this.prototype.contentAttributes = ['cite'];
  }
}

export const htmlQuoteElementImplementations = [impl(HTMLBlockQuoteElementImpl), impl(HTMLQElementImpl)];

/*
 * [Exposed=Window]
 * interface HTMLQuoteElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectURL] attribute USVString cite;
 * };
 */
export const htmlQuoteElementIDL = defineInterface({
  name: 'HTMLQuoteElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: htmlQuoteElementImplementations,
  namespaceURI: HTML_NAMESPACE,
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
