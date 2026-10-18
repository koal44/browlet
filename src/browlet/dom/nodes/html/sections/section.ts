import { HTMLElementImpl } from '../html-element';

/** The section element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-section-element
export class HTMLSectionElementImpl extends HTMLElementImpl {
  static override localName = 'section';
}
