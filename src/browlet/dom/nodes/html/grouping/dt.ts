import { HTMLElementImpl } from '../html-element';

/** The dt element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#the-dt-element
export class HTMLDTElementImpl extends HTMLElementImpl {
  static override localName = 'dt';
}
