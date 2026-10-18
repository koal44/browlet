import { HTMLElementImpl } from '../html-element';

/** The code element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-code-element
export class HTMLCodeElementImpl extends HTMLElementImpl {
  static override localName = 'code';
}
