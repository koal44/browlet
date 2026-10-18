import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Table-caption element identity. */
// https://html.spec.whatwg.org/multipage/tables.html#htmltablecaptionelement
export class HTMLTableCaptionElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLCaption;
    this.prototype.categories = [];
  }

  override canOmitEndTag(): boolean {
    return !this.startsWithWhitespaceOrComment(this.nextContent());
  }
}

/*
 * [Exposed=Window]
 * interface HTMLTableCaptionElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   // also has obsolete members
 * };
 */
export const htmlTableCaptionElementIDL = defineInterface({
  name: 'HTMLTableCaptionElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLTableCaptionElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['caption'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
