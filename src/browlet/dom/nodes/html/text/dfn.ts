import { HTMLElementImpl } from '../html-element';

/** The dfn element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-dfn-element
export class HTMLDFNElementImpl extends HTMLElementImpl {
  static override localName = 'dfn';
}
