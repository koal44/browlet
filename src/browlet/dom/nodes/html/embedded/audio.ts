import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { defineElementInterface } from '../../element';
import { HTMLMediaElementImpl } from './media';

/** Audio element's shared media-loading state. */
// https://html.spec.whatwg.org/multipage/media.html#the-audio-element
// PROVISIONAL: the Audio constructor and media loading/playback remain unimplemented.
export class HTMLAudioElementImpl extends HTMLMediaElementImpl {
  static is(value: unknown): value is HTMLAudioElementImpl {
    return value instanceof HTMLAudioElementImpl;
  }
}

/*
 * [Exposed=Window]
 * interface HTMLAudioElement : HTMLMediaElement {
 *   [HTMLConstructor] constructor();
 * };
 */
export const htmlAudioElementIDL = defineInterface({
  name: 'HTMLAudioElement',
  inherits: 'HTMLMediaElement',
  exposed: 'Window',
  implementation: impl(HTMLAudioElementImpl),
  members: [],
});

export const htmlAudioElementInterface = defineElementInterface({
  definition: htmlAudioElementIDL,
  localNames: ['audio'],
  namespaceURI: HTML_NAMESPACE,
});
