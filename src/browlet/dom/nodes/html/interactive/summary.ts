import { HTMLElementImpl } from '../html-element';

/** The summary element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/interactive-elements.html#the-summary-element
export class HTMLSummaryElementImpl extends HTMLElementImpl {
  static override localName = 'summary';
}
