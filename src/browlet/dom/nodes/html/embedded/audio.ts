import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { HTMLMediaElementImpl } from './media';

/** Audio element's shared media-loading state. */
// https://html.spec.whatwg.org/multipage/media.html#the-audio-element
export class HTMLAudioElementImpl extends HTMLMediaElementImpl {
  static is(value: unknown): value is HTMLAudioElementImpl {
    return value instanceof HTMLAudioElementImpl;
  }
}

/*
 * [Exposed=Window,
 *  LegacyFactoryFunction=Audio(optional DOMString src)]
 * interface HTMLAudioElement : HTMLMediaElement {
 *   [HTMLConstructor] constructor();
 * };
 */
export const htmlAudioElementIDL = defineInterface({
  name: 'HTMLAudioElement',
  inherits: 'HTMLMediaElement',
  exposed: 'Window',
  implementation: impl(HTMLAudioElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['audio'],
  members: [ctor([], xattr('HTMLConstructor'))],
});
