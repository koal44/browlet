import { HTMLElementImpl } from '../html-element';

/** The main element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#the-main-element
export class HTMLMainElementImpl extends HTMLElementImpl {
  static override localName = 'main';
}
