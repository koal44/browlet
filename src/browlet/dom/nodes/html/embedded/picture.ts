import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Picture element identity. */
// https://html.spec.whatwg.org/multipage/embedded-content.html#htmlpictureelement
export class HTMLPictureElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLPicture;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Embedded, ContentCategory.Palpable,
    ];
  }
}

/*
 * [Exposed=Window]
 * interface HTMLPictureElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 * };
 */
export const htmlPictureElementIDL = defineInterface({
  name: 'HTMLPictureElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLPictureElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['picture'],
  members: [ctor([], xattr('HTMLConstructor'))],
});
