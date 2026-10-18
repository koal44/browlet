import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLElementImpl } from '../html-element';

/** Canvas element identity. */
// https://html.spec.whatwg.org/multipage/canvas.html#htmlcanvaselement
export class HTMLCanvasElementImpl extends HTMLElementImpl {}

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
