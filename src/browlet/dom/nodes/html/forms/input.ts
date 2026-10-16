import { HTML_NAMESPACE } from '../../../../../infra/index';
import { attr, defineInterface, idlType, impl, reflect, reflectEnumerated, xattr } from '../../../../../web-idl/index';

import { EnumeratedAttribute } from '../../../../html/microsyntaxes/index';

import { defineElementInterface } from '../../element';
import { HTMLElementImpl } from '../html-element';

/** Input type and checkedness needed by RadioNodeList. */
// https://html.spec.whatwg.org/multipage/input.html#htmlinputelement
// PROVISIONAL: form association, radio groups, activation, value modes, and the remaining input API await §4.10.
export class HTMLInputElementImpl extends HTMLElementImpl {
  /** Internal checkedness, independent of the checked content attribute. */
  // https://html.spec.whatwg.org/#concept-fe-checked
  checkedness = false;
  /** Whether author interaction has detached checkedness from the default. */
  // https://html.spec.whatwg.org/#concept-input-dirty-checkedness-flag
  dirtyCheckedness = false;

  static is(value: unknown): value is HTMLInputElementImpl {
    return value instanceof HTMLInputElementImpl;
  }

  /** Canonical input state; absent or invalid type attributes select Text. */
  get typeState(): InputTypeState {
    return inputTypeAttribute.getState(this.getAttributeNS(null, 'type'))!;
  }

  // https://html.spec.whatwg.org/#dom-input-checked
  get checked(): boolean { return this.checkedness; }
  set checked(value: boolean) {
    this.dirtyCheckedness = true;
    this.setCheckedness(value);
  }

  /** Change internal checkedness without changing dirty checkedness. */
  // https://html.spec.whatwg.org/#radio-button-group
  setCheckedness(value: boolean): void {
    this.checkedness = value;
    if (value && this.typeState === 'radio') this.updateRadioButtonGroup();
  }

  /** Uncheck the other radio buttons with the same name, tree, and form owner. */
  // https://html.spec.whatwg.org/#radio-button-group
  updateRadioButtonGroup(): void {
    // TODO: Form-owner association and radio-group maintenance belong here. See forms/ROADMAP.md.
  }

  override attributeChanged(
    localName: string, oldValue: string | null, value: string | null, namespace: string | null,
  ): void {
    super.attributeChanged(localName, oldValue, value, namespace);
    if (namespace !== null) return;
    if (localName === 'checked' && !this.dirtyCheckedness) this.setCheckedness(value !== null);
    if ((localName === 'type' || localName === 'name') && this.checkedness && this.typeState === 'radio') {
      this.updateRadioButtonGroup();
    }
    // TODO: Type-change steps, form-owner changes, connection, and cloning also update input state.
  }
}

const inputTypes = [
  'hidden', 'text', 'search', 'tel', 'url', 'email', 'password', 'date', 'month', 'week', 'time',
  'datetime-local', 'number', 'range', 'color', 'checkbox', 'radio', 'file', 'submit', 'image', 'reset', 'button',
] as const;
type InputTypeState = typeof inputTypes[number];

// https://html.spec.whatwg.org/#attr-input-type
const inputTypeAttribute = new EnumeratedAttribute<InputTypeState>(
  inputTypes.map((state) => ({ state, keywords: [state] })),
  { missingValueDefault: 'text', invalidValueDefault: 'text' },
);

/*
 * HTMLInputElement's implemented fragment:
 * [CEReactions] attribute DOMString type;
 * [CEReactions, Reflect="checked"] attribute boolean defaultChecked;
 * attribute boolean checked;
 */
export const htmlInputElementIDL = defineInterface({
  name: 'HTMLInputElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLInputElementImpl),
  members: [
    attr('type', idlType.DOMString, xattr('CEReactions', reflectEnumerated(inputTypeAttribute))),
    attr('defaultChecked', idlType.boolean, xattr('CEReactions', reflect({ name: 'checked' }))),
    attr('checked', idlType.boolean),
  ],
});

export const htmlInputElementInterface = defineElementInterface({
  definition: htmlInputElementIDL,
  localNames: ['input'],
  namespaceURI: HTML_NAMESPACE,
});
