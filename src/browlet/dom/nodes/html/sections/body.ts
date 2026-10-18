import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag, flowContent } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Document-body identity used by Document tree accessors. */
// https://html.spec.whatwg.org/multipage/sections.html#the-body-element
export class HTMLBodyElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLBody;
    this.prototype.categories = [];
    this.prototype.contentModel = { childRules: [flowContent] };
  }

  override canOmitStartTag(_previousEndTagOmitted: boolean): boolean {
    if (this.hasStartTagAttributes()) return false;
    const first = this.nextContent(this.firstChild);
    return !this.startsWithWhitespaceOrComment(first) &&
      !(first?.isElement() && (first.tag === ElementTag.HTMLMeta || first.tag === ElementTag.HTMLNoscript ||
        first.tag === ElementTag.HTMLLink || first.tag === ElementTag.HTMLScript ||
        first.tag === ElementTag.HTMLStyle || first.tag === ElementTag.HTMLTemplate));
  }

  override canOmitEndTag(): boolean {
    return !this.nextContent()?.isComment();
  }
}

/*
 * [Exposed=Window]
 * interface HTMLBodyElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 *
 * HTMLBodyElement includes WindowEventHandlers;
 */
export const htmlBodyElementIDL = defineInterface({
  name: 'HTMLBodyElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLBodyElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['body'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
