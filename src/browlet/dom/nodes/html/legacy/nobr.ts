import { HTMLElementImpl } from '../html-element';

/** The nobr element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLNoBRElementImpl extends HTMLElementImpl {
  static override localName = 'nobr';
}
