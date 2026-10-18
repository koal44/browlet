import { HTMLElementImpl } from '../html-element';

/** The wbr element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-wbr-element
export class HTMLWBRElementImpl extends HTMLElementImpl {
  static override localName = 'wbr';
}
