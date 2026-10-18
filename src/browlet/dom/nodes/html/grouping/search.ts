import { HTMLElementImpl } from '../html-element';

/** The search element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#the-search-element
export class HTMLSearchElementImpl extends HTMLElementImpl {
  static override localName = 'search';
}
