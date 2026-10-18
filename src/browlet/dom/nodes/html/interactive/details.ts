import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory, flowContent  } from '../content-model';
import { HTMLSummaryElementImpl } from './summary';

/** Disclosure element identity. */
// https://html.spec.whatwg.org/multipage/interactive-elements.html#htmldetailselement
export class HTMLDetailsElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLDetails;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Interactive, ContentCategory.Palpable,
    ];
    // https://html.spec.whatwg.org/multipage/interactive-elements.html#the-details-element
    this.prototype.contentModel = {
      children: [
        {
          kind: 'sequence',
          rules: [
            { kind: 'element', implementation: HTMLSummaryElementImpl },
            flowContent,
          ],
        },
      ],
    };
  }
}

/*
 * [Exposed=Window]
 * interface HTMLDetailsElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString name;
 *   [CEReactions, Reflect] attribute boolean open;
 * };
 */
export const htmlDetailsElementIDL = defineInterface({
  name: 'HTMLDetailsElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLDetailsElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['details'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
