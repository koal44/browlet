import { HTMLElementImpl } from '../html-element';

/** The noframes element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLNoFramesElementImpl extends HTMLElementImpl {
  static override localName = 'noframes';
}
