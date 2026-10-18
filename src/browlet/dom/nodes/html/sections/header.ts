import { HTMLElementImpl } from '../html-element';

/** The header element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-header-element
export class HTMLHeaderElementImpl extends HTMLElementImpl {
  static override localName = 'header';
}
