import { HTMLElementImpl } from '../html-element';

/** The em element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-em-element
export class HTMLEmElementImpl extends HTMLElementImpl {
  static override localName = 'em';
}
