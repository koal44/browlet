import { HTMLElementImpl } from '../html-element';

/** The dd element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#the-dd-element
export class HTMLDDElementImpl extends HTMLElementImpl {
  static override localName = 'dd';
}
