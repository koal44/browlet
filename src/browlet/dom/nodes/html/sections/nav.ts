import { HTMLElementImpl } from '../html-element';

/** The nav element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-nav-element
export class HTMLNavElementImpl extends HTMLElementImpl {
  static override localName = 'nav';
}
