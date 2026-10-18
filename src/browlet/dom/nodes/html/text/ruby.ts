import { HTMLElementImpl } from '../html-element';

/** The ruby element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-ruby-element
export class HTMLRubyElementImpl extends HTMLElementImpl {
  static override localName = 'ruby';
}
