import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** The noscript element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/scripting.html#the-noscript-element
export class HTMLNoScriptElementImpl extends HTMLElementImpl {
  static override localName = 'noscript';
  static {
    this.prototype.tag = ElementTag.HTMLNoscript;
    this.prototype.categories = [
      ContentCategory.Metadata, ContentCategory.Flow, ContentCategory.Phrasing,
    ];
  }
}
