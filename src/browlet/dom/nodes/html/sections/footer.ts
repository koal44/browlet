import { HTMLElementImpl } from '../html-element';

/** The footer element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-footer-element
export class HTMLFooterElementImpl extends HTMLElementImpl {
  static override localName = 'footer';
}
