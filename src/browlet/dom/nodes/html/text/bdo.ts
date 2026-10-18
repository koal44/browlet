import { HTMLElementImpl } from '../html-element';

/** The bdo element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-bdo-element
export class HTMLBDOElementImpl extends HTMLElementImpl {
  static override localName = 'bdo';
}
