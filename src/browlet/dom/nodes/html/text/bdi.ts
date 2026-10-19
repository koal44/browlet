import type { TextDirection } from '../../../../../infra/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The bdi element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-bdi-element
export class HTMLBDIElementImpl extends HTMLElementImpl {
  static override localName = 'bdi';
  static {
    this.prototype.tag = ElementTag.HTMLBdi;
    this.prototype.excludeFromAutoDirection = true;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable,
    ];
  }

  protected override getDefaultDirection(): TextDirection {
    return this.getAutoDirection() ?? 'ltr';
  }
}
