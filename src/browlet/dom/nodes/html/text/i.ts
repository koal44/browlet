import { HTMLElementImpl } from '../html-element';

/** The i element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-i-element
export class HTMLIElementImpl extends HTMLElementImpl {
  static override localName = 'i';
}
