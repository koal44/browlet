import { HTMLElementImpl } from '../html-element';

/** The small element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-small-element
export class HTMLSmallElementImpl extends HTMLElementImpl {
  static override localName = 'small';
}
