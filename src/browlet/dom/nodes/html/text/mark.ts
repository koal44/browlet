import { HTMLElementImpl } from '../html-element';

/** The mark element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-mark-element
export class HTMLMarkElementImpl extends HTMLElementImpl {
  static override localName = 'mark';
}
