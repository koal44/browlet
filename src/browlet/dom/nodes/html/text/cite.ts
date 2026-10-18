import { HTMLElementImpl } from '../html-element';

/** The cite element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-cite-element
export class HTMLCiteElementImpl extends HTMLElementImpl {
  static override localName = 'cite';
}
