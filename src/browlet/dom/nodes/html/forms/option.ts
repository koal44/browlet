import { HTML_NAMESPACE } from '../../../../../infra/index';
import { attr, ctor, defineInterface, idlType, impl, reflect, xattr } from '../../../../../web-idl/index';

import { ElementTag } from '../../element-definitions/index';

import { HTMLElementImpl } from '../html-element';

/** Option selection state owned independently of its selected content attribute. */
// https://html.spec.whatwg.org/multipage/form-elements.html#htmloptionelement
export class HTMLOptionElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLOption;
    this.prototype.categories = [];
  }

  // https://html.spec.whatwg.org/#concept-option-selectedness
  selectedness = false;
  // https://html.spec.whatwg.org/#concept-option-dirtiness
  dirtiness = false;

  static is(value: unknown): value is HTMLOptionElementImpl {
    return value instanceof HTMLOptionElementImpl;
  }

  // https://html.spec.whatwg.org/#dom-option-selected
  get selected(): boolean { return this.selectedness; }
  set selected(value: boolean) {
    this.selectedness = value;
    this.dirtiness = true;
    this.askForReset();
  }

  override canOmitEndTag(): boolean {
    const next = this.nextContent();
    if (next === null) return this.parentElement !== null;
    return next.isElement() && (next.tag === ElementTag.HTMLOption ||
      next.tag === ElementTag.HTMLOptgroup || next.tag === ElementTag.HTMLHr);
  }

  /** Notify the owning select after changing this option's selection. */
  // https://html.spec.whatwg.org/#ask-for-a-reset
  askForReset(): void {
    // TODO: Notify the nearest ancestor select, run selectedness setting, and update selectedcontent.
  }

  override attributeChanged(
    localName: string, oldValue: string | null, value: string | null, namespace: string | null,
  ): void {
    super.attributeChanged(localName, oldValue, value, namespace);
    if (namespace === null && localName === 'selected' && !this.dirtiness) {
      this.selectedness = value !== null;
      this.askForReset();
    }
  }
}

/*
 * [Exposed=Window,
 *  LegacyFactoryFunction=Option(optional DOMString text = "", optional DOMString value, optional boolean defaultSelected = false, optional boolean selected = false)]
 * interface HTMLOptionElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute boolean disabled;
 *   readonly attribute HTMLFormElement? form;
 *   [CEReactions, ReflectSetter] attribute DOMString label;
 *   [CEReactions, Reflect="selected"] attribute boolean defaultSelected;
 *   attribute boolean selected;
 *   [CEReactions, ReflectSetter] attribute DOMString value;
 *
 *   [CEReactions] attribute DOMString text;
 *   readonly attribute long index;
 * };
 */
export const htmlOptionElementIDL = defineInterface({
  name: 'HTMLOptionElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLOptionElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['option'],
  members: [
    ctor([], xattr('HTMLConstructor')),
    attr('defaultSelected', idlType.boolean, xattr('CEReactions', reflect({ name: 'selected' }))),
    attr('selected', idlType.boolean),
  ],
});
