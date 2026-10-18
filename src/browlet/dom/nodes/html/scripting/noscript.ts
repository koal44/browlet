import { HTMLElementImpl } from '../html-element';

/** The noscript element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/scripting.html#the-noscript-element
export class HTMLNoScriptElementImpl extends HTMLElementImpl {
  static override localName = 'noscript';
}
