import { HTMLElementImpl } from '../html-element';

/** The rtc element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#non-conforming-features
export class HTMLRTCElementImpl extends HTMLElementImpl {
  static override localName = 'rtc';
}
