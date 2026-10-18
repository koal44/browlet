import { HTMLElementImpl } from '../html-element';

/** The basefont element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLBaseFontElementImpl extends HTMLElementImpl {
  static override localName = 'basefont';
}
