import { HTMLElementImpl } from '../html-element';

/** The u element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-u-element
export class HTMLUElementImpl extends HTMLElementImpl {
  static override localName = 'u';
}
