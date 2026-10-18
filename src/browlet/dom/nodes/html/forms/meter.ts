import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** Scalar-gauge element identity. */
// https://html.spec.whatwg.org/multipage/form-elements.html#htmlmeterelement
export class HTMLMeterElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLMeter;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable, ContentCategory.Labelable,
    ];
  }
}

/*
 * [Exposed=Window]
 * interface HTMLMeterElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectSetter] attribute double value;
 *   [CEReactions, ReflectSetter] attribute double min;
 *   [CEReactions, ReflectSetter] attribute double max;
 *   [CEReactions, ReflectSetter] attribute double low;
 *   [CEReactions, ReflectSetter] attribute double high;
 *   [CEReactions, ReflectSetter] attribute double optimum;
 *   readonly attribute NodeList labels;
 * };
 */
export const htmlMeterElementIDL = defineInterface({
  name: 'HTMLMeterElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLMeterElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['meter'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
