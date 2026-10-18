import { HTMLElementImpl } from '../html-element';

/** The kbd element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-kbd-element
export class HTMLKbdElementImpl extends HTMLElementImpl {
  static override localName = 'kbd';
}
