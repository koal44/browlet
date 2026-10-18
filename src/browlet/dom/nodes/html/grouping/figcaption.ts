import { HTMLElementImpl } from '../html-element';

/** The figcaption element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#the-figcaption-element
export class HTMLFigCaptionElementImpl extends HTMLElementImpl {
  static override localName = 'figcaption';
}
