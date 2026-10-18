import { HTMLElementImpl } from '../html-element';

/** The noembed element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLNoEmbedElementImpl extends HTMLElementImpl {
  static override localName = 'noembed';
}
