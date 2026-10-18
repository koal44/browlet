import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The del element, exposed through HTMLModElement. */
// https://html.spec.whatwg.org/multipage/edits.html#the-del-element
export class HTMLDelElementImpl extends HTMLElementImpl {
  static override localName = 'del';
  static {
    this.prototype.tag = ElementTag.HTMLDel;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}

/** The ins element, exposed through HTMLModElement. */
// https://html.spec.whatwg.org/multipage/edits.html#the-ins-element
export class HTMLInsElementImpl extends HTMLElementImpl {
  static override localName = 'ins';
  static {
    this.prototype.tag = ElementTag.HTMLIns;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }
}

/*
 * [Exposed=Window]
 * interface HTMLModElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectURL] attribute USVString cite;
 *   [CEReactions, Reflect] attribute DOMString dateTime;
 * };
 */
export const htmlModElementIDL = defineInterface({
  name: 'HTMLModElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: [impl(HTMLDelElementImpl), impl(HTMLInsElementImpl)],
  namespaceURI: HTML_NAMESPACE,
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
