import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Canvas element identity. */
// https://html.spec.whatwg.org/multipage/canvas.html#htmlcanvaselement
export class HTMLCanvasElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLCanvas;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Embedded, ContentCategory.Palpable,
    ];
  }
}

/*
 * [Exposed=Window]
 * interface HTMLCanvasElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions] attribute unsigned long width;
 *   [CEReactions] attribute unsigned long height;
 *
 *   RenderingContext? getContext(DOMString contextId, optional any options = null);
 *
 *   USVString toDataURL(optional DOMString type = "image/png", optional any quality);
 *   undefined toBlob(BlobCallback _callback, optional DOMString type = "image/png", optional any quality);
 *   OffscreenCanvas transferControlToOffscreen();
 * };
 *
 */
export const htmlCanvasElementIDL = defineInterface({
  name: 'HTMLCanvasElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLCanvasElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['canvas'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
