import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag, flowContent } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** List-item element identity. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#htmllielement
export class HTMLLIElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLLi;
    this.prototype.categories = [];
    this.prototype.contentModel = { childRules: [flowContent] };
  }

  override canOmitEndTag(): boolean {
    const next = this.nextContent();
    if (next === null) return this.parentElement !== null;
    return next.isElement() && next.tag === ElementTag.HTMLLi;
  }
}

/*
 * [Exposed=Window]
 * interface HTMLLIElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute long value;
 *
 *   // also has obsolete members
 * };
 */
export const htmlLIElementIDL = defineInterface({
  name: 'HTMLLIElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLLIElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['li'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
