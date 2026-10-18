import { HTMLElementImpl } from '../html-element';

/** The rb element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLRBElementImpl extends HTMLElementImpl {
  static override localName = 'rb';
}
