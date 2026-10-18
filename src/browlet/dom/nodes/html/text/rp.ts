import { HTMLElementImpl } from '../html-element';

/** The rp element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-rp-element
export class HTMLRPElementImpl extends HTMLElementImpl {
  static override localName = 'rp';
}
