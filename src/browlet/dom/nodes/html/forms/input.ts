import { HTML_NAMESPACE, firstStrongDirection, type TextDirection } from '../../../../../infra/index';
import { InternalError } from '../../../../../infra/internal-error';
import {
  attr, ctor, defineInterface, idlType, impl, reflect, reflectEnumerated, xattr,
} from '../../../../../web-idl/index';

import { ElementTag, ContentCategory, emptyContent } from '../../element-definitions/index';
import { EnumeratedAttribute } from '../../../../html/microsyntaxes/index';

import { HTMLElementImpl } from '../html-element';

/** Input state used by collections and directionality. */
// https://html.spec.whatwg.org/multipage/input.html#htmlinputelement
export class HTMLInputElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLInput;
    this.prototype.isAllNamedElement = true;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.FormAssociated,
      ContentCategory.Listed, ContentCategory.Submittable, ContentCategory.Resettable,
      ContentCategory.AutocapitalizeAndAutocorrectInheriting,
    ];
    // https://html.spec.whatwg.org/multipage/input.html#the-input-element
    this.prototype.contentModel = { childRules: [emptyContent] };
    this.prototype.translatableAttributes = [...this.prototype.translatableAttributes, 'alt', 'placeholder'];
    this.prototype.directionalityAttributes = [...this.prototype.directionalityAttributes, 'alt', 'placeholder'];
  }

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

  /** Current control value, including edits and type-dependent sanitization, rather than its default attribute. */
  // https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#concept-fe-value
  get value(): string {
    // TODO(HTML §4.10.5): Supply the live value and dirty-value/type-change lifecycle.
    throw new InternalError('Input current value is not implemented');
  }

  // https://html.spec.whatwg.org/#dom-input-checked
  get checked(): boolean { return this.checkedness; }
  set checked(value: boolean) {
    this.dirtyCheckedness = true;
    this.setCheckedness(value);
  }

  override hasCategory(category: ContentCategory): boolean {
    if (category === ContentCategory.Interactive || category === ContentCategory.Labelable ||
      category === ContentCategory.Palpable) {
      return this.typeState !== 'hidden';
    }
    return super.hasCategory(category);
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

  protected override getDefaultDirection(): TextDirection {
    return this.typeState === 'tel' ? 'ltr' : super.getDefaultDirection();
  }

  protected override getAutoDirection(): TextDirection | null {
    switch (this.typeState) {
      case 'hidden': case 'text': case 'search': case 'tel': case 'url': case 'email':
      case 'password': case 'submit': case 'reset': case 'button': {
        const value = this.value;
        return value === '' ? null : firstStrongDirection(value) ?? 'ltr';
      }
      default:
        // SPEC_CLASH(dir-nontext-input): Follow HTML/WebKit; Chromium misses child updates, Firefox ignores them.
        return super.getAutoDirection();
    }
  }

  protected override isTranslatableAttributeName(name: string): boolean {
    if (name === 'value') {
      const state = this.typeState;
      return state === 'button' || state === 'reset';
    }
    return super.isTranslatableAttributeName(name);
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
 * [Exposed=Window]
 * interface HTMLInputElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute DOMString accept;
 *   [CEReactions, Reflect] attribute boolean alpha;
 *   [CEReactions, Reflect] attribute DOMString alt;
 *   [CEReactions, ReflectSetter] attribute DOMString autocomplete;
 *   [CEReactions, Reflect="checked"] attribute boolean defaultChecked;
 *   attribute boolean checked;
 *   [CEReactions] attribute DOMString colorSpace;
 *   [CEReactions, Reflect] attribute DOMString dirName;
 *   [CEReactions, Reflect] attribute boolean disabled;
 *   readonly attribute HTMLFormElement? form;
 *   attribute FileList? files;
 *   [CEReactions, ReflectSetter] attribute USVString formAction;
 *   [CEReactions] attribute DOMString formEnctype;
 *   [CEReactions] attribute DOMString formMethod;
 *   [CEReactions, Reflect] attribute boolean formNoValidate;
 *   [CEReactions, Reflect] attribute DOMString formTarget;
 *   [CEReactions, ReflectSetter] attribute unsigned long height;
 *   attribute boolean indeterminate;
 *   readonly attribute HTMLDataListElement? list;
 *   [CEReactions, Reflect] attribute DOMString max;
 *   [CEReactions, ReflectNonNegative] attribute long maxLength;
 *   [CEReactions, Reflect] attribute DOMString min;
 *   [CEReactions, ReflectNonNegative] attribute long minLength;
 *   [CEReactions, Reflect] attribute boolean multiple;
 *   [CEReactions, Reflect] attribute DOMString name;
 *   [CEReactions, Reflect] attribute DOMString pattern;
 *   [CEReactions, Reflect] attribute DOMString placeholder;
 *   [CEReactions, Reflect] attribute boolean readOnly;
 *   [CEReactions, Reflect] attribute boolean required;
 *   [CEReactions, Reflect] attribute unsigned long size;
 *   [CEReactions, ReflectURL] attribute USVString src;
 *   [CEReactions, Reflect] attribute DOMString step;
 *   [CEReactions] attribute DOMString type;
 *   [CEReactions, Reflect="value"] attribute DOMString defaultValue;
 *   [CEReactions] attribute [LegacyNullToEmptyString] DOMString value;
 *   attribute object? valueAsDate;
 *   attribute unrestricted double valueAsNumber;
 *   [CEReactions, ReflectSetter] attribute unsigned long width;
 *
 *   undefined stepUp(optional long n = 1);
 *   undefined stepDown(optional long n = 1);
 *
 *   readonly attribute boolean willValidate;
 *   readonly attribute ValidityState validity;
 *   readonly attribute DOMString validationMessage;
 *   boolean checkValidity();
 *   boolean reportValidity();
 *   undefined setCustomValidity(DOMString error);
 *
 *   readonly attribute NodeList? labels;
 *
 *   undefined select();
 *   attribute unsigned long? selectionStart;
 *   attribute unsigned long? selectionEnd;
 *   attribute DOMString? selectionDirection;
 *   undefined setRangeText(DOMString replacement);
 *   undefined setRangeText(DOMString replacement, unsigned long start, unsigned long end, optional SelectionMode selectionMode = "preserve");
 *   undefined setSelectionRange(unsigned long start, unsigned long end, optional DOMString direction);
 *
 *   undefined showPicker();
 *
 *   // also has obsolete members
 * };
 *
 * HTMLInputElement includes PopoverTargetAttributes;
 */
export const htmlInputElementIDL = defineInterface({
  name: 'HTMLInputElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLInputElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['input'],
  members: [
    ctor([], xattr('HTMLConstructor')),
    attr('type', idlType.DOMString, xattr('CEReactions', reflectEnumerated(inputTypeAttribute))),
    attr('defaultChecked', idlType.boolean, xattr('CEReactions', reflect({ name: 'checked' }))),
    attr('checked', idlType.boolean),
  ],
});
