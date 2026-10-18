import { HTMLElementImpl } from '../html-element';

/** The var element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-var-element
export class HTMLVarElementImpl extends HTMLElementImpl {
  static override localName = 'var';
}
