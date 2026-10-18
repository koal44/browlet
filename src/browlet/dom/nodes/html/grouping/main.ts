import { InternalError } from '../../../../../infra/internal-error';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** The main element, exposed through HTMLElement. */
// https://html.spec.whatwg.org/multipage/grouping-content.html#the-main-element
export class HTMLMainElementImpl extends HTMLElementImpl {
  static override localName = 'main';
  static {
    this.prototype.tag = ElementTag.HTMLMain;
    this.prototype.categories = [
      ContentCategory.Palpable,
    ];
  }

  override hasCategory(category: ContentCategory): boolean {
    if (category === ContentCategory.Flow) return this.isHierarchicallyCorrect();
    return super.hasCategory(category);
  }

  /** Whether the ancestor chain satisfies main's restrictions, including unnamed form ancestors. */
  // https://html.spec.whatwg.org/multipage/grouping-content.html#hierarchically-correct-main-element
  isHierarchicallyCorrect(): boolean {
    // TODO: §4.4's main-element rules require the unfinished accessible-name computation for form ancestors.
    throw new InternalError('Main-element hierarchy checking is not implemented');
  }
}
