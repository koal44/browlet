import { HTMLElementImpl } from '../html-element';

/** The figure element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#the-figure-element
export class HTMLFigureElementImpl extends HTMLElementImpl {
  static override localName = 'figure';
}
