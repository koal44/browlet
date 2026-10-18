import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Contains document metadata before the body. */
// https://html.spec.whatwg.org/multipage/semantics.html#the-head-element
export class HTMLHeadElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLHead;
    this.prototype.categories = [];
  }

  static is(value: unknown): value is HTMLHeadElementImpl {
    return value instanceof HTMLHeadElementImpl;
  }

  override canOmitStartTag(_previousEndTagOmitted: boolean): boolean {
    if (this.hasStartTagAttributes()) return false;
    const first = this.nextContent(this.firstChild);
    return first === null || first.isElement();
  }

  override canOmitEndTag(): boolean {
    return !this.startsWithWhitespaceOrComment(this.nextContent());
  }
}

/*
 * [Exposed=Window]
 * interface HTMLHeadElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 * };
 */
export const htmlHeadElementIDL = defineInterface({
  name: 'HTMLHeadElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLHeadElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['head'],
  members: [ctor([], xattr('HTMLConstructor'))],
});
