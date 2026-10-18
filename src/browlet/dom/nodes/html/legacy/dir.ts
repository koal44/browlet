import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-tag';
import { HTMLElementImpl } from '../html-element';

/** Obsolete directory-list element identity. */
// https://html.spec.whatwg.org/multipage/obsolete.html#htmldirectoryelement
export class HTMLDirectoryElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLDir;
  }
}

/*
 * [Exposed=Window]
 * interface HTMLDirectoryElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute boolean compact;
 * };
 */
export const htmlDirectoryElementIDL = defineInterface({
  name: 'HTMLDirectoryElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLDirectoryElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['dir'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
