import { HTML_NAMESPACE } from '../../../../../infra/index';
import { attr, defineInterface, idlType, impl, reflect, xattr } from '../../../../../web-idl/index';

import { defineElementInterface } from '../../element';
import { HTMLElementImpl } from '../html-element';

/** Option selection state owned independently of its selected content attribute. */
// https://html.spec.whatwg.org/multipage/form-elements.html#htmloptionelement
// PROVISIONAL: selection reset, insertion/removal, cloning, and the remaining option API await §4.10.
export class HTMLOptionElementImpl extends HTMLElementImpl {
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
 * HTMLOptionElement's implemented fragment:
 * [CEReactions, Reflect="selected"] attribute boolean defaultSelected;
 * attribute boolean selected;
 */
export const htmlOptionElementIDL = defineInterface({
  name: 'HTMLOptionElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLOptionElementImpl),
  members: [
    attr('defaultSelected', idlType.boolean, xattr('CEReactions', reflect({ name: 'selected' }))),
    attr('selected', idlType.boolean),
  ],
});

export const htmlOptionElementInterface = defineElementInterface({
  definition: htmlOptionElementIDL,
  localNames: ['option'],
  namespaceURI: HTML_NAMESPACE,
});
