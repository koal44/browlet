import { HTMLElementImpl } from '../html-element';

/** The rt element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-rt-element
export class HTMLRTElementImpl extends HTMLElementImpl {
  static override localName = 'rt';
}
