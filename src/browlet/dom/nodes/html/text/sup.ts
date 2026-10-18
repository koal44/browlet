import { HTMLElementImpl } from '../html-element';

/** The sup element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-sub-and-sup-elements
export class HTMLSupElementImpl extends HTMLElementImpl {
  static override localName = 'sup';
}
