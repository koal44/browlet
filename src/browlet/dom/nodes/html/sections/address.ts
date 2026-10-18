import { HTMLElementImpl } from '../html-element';

/** The address element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-address-element
export class HTMLAddressElementImpl extends HTMLElementImpl {
  static override localName = 'address';
}
