import { HTMLElementImpl } from '../html-element';

/** The aside element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-aside-element
export class HTMLAsideElementImpl extends HTMLElementImpl {
  static override localName = 'aside';
}
