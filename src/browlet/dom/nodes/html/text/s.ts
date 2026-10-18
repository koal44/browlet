import { HTMLElementImpl } from '../html-element';

/** The s element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-s-element
export class HTMLSElementImpl extends HTMLElementImpl {
  static override localName = 's';
}
