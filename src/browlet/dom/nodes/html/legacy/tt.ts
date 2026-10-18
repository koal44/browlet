import { HTMLElementImpl } from '../html-element';

/** The tt element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLTTElementImpl extends HTMLElementImpl {
  static override localName = 'tt';
}
