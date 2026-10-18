import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';
import { ContentCategory } from '../content-model';

/** Progress-indicator element identity. */
// https://html.spec.whatwg.org/multipage/form-elements.html#htmlprogresselement
export class HTMLProgressElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLProgress;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Palpable, ContentCategory.Labelable,
    ];
  }
}

/*
 * [Exposed=Window]
 * interface HTMLProgressElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, ReflectSetter] attribute double value;
 *   [CEReactions, ReflectPositive, ReflectDefault=1.0] attribute double max;
 *   readonly attribute double position;
 *   readonly attribute NodeList labels;
 * };
 */
export const htmlProgressElementIDL = defineInterface({
  name: 'HTMLProgressElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLProgressElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['progress'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
