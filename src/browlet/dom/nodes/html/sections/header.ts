import { ElementTag, ContentCategory, flowContent } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';
import { HTMLFooterElementImpl } from './footer';

/** The header element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/sections.html#the-header-element
export class HTMLHeaderElementImpl extends HTMLElementImpl {
  static override localName = 'header';
  static {
    this.prototype.tag = ElementTag.HTMLHeader;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Palpable,
    ];
    this.prototype.contentModel = {
      childRules: [flowContent],
      forbiddenDescendants: [
        { kind: 'element', implementation: HTMLHeaderElementImpl },
        { kind: 'element', implementation: HTMLFooterElementImpl },
      ],
    };
  }
}
