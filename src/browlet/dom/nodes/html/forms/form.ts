import { HTML_NAMESPACE, InternalError } from '../../../../../infra/index';
import { ctor, defineInterface, impl, reference, roAttr, xattr } from '../../../../../web-idl/index';

import { ElementTag, ContentCategory, SanitizationCategory } from '../../element-definitions/index';

import type { ElementImpl } from '../../element';
import { HTMLElementImpl, type DocumentNamedItemType } from '../html-element';
import { HTMLFormControlsCollectionImpl } from './form-controls-collection';

/** Form identity and ownership of its stable controls collection. */
// https://html.spec.whatwg.org/multipage/forms.html#htmlformelement
export class HTMLFormElementImpl extends HTMLElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLForm;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Palpable,
    ];
    this.prototype.sanitization = {
      category: SanitizationCategory.Uncategorized,
      navigatingURLAttributes: ['action'],
    };
  }

  override readonly isAllNamedElement = true;
  #elements: HTMLFormControlsCollectionImpl | undefined;

  static is(value: unknown): value is HTMLFormElementImpl {
    return value instanceof HTMLFormElementImpl;
  }

  // https://html.spec.whatwg.org/#dom-form-elements
  get elements(): HTMLFormControlsCollectionImpl {
    return this.#elements ??= new HTMLFormControlsCollectionImpl({
      root: this,
      collect: () => this.getListedElements(),
    });
  }

  override getDocumentNamedItemType(): DocumentNamedItemType {
    return 'name';
  }

  /** Listed elements whose form owner is this form, in tree order, excluding image inputs. */
  // https://html.spec.whatwg.org/#dom-form-elements
  getListedElements(): ElementImpl[] {
    // TODO: Form-owner association must include external controls and form-associated custom elements.
    throw new InternalError('Form control membership requires form-owner association');
  }
}

/*
 * [Exposed=Window,
 *  LegacyOverrideBuiltIns,
 *  LegacyUnenumerableNamedProperties]
 * interface HTMLFormElement : HTMLElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect="accept-charset"] attribute DOMString acceptCharset;
 *   [CEReactions, ReflectSetter] attribute USVString action;
 *   [CEReactions] attribute DOMString autocomplete;
 *   [CEReactions] attribute DOMString enctype;
 *   [CEReactions] attribute DOMString encoding;
 *   [CEReactions] attribute DOMString method;
 *   [CEReactions, Reflect] attribute DOMString name;
 *   [CEReactions, Reflect] attribute boolean noValidate;
 *   [CEReactions, Reflect] attribute DOMString target;
 *   [CEReactions, Reflect] attribute DOMString rel;
 *   [SameObject, PutForwards=value, Reflect="rel"] readonly attribute DOMTokenList relList;
 *
 *   [SameObject] readonly attribute HTMLFormControlsCollection elements;
 *   readonly attribute unsigned long length;
 *   getter Element (unsigned long index);
 *   getter (RadioNodeList or Element) (DOMString name);
 *
 *   undefined submit();
 *   undefined requestSubmit(optional HTMLElement? submitter = null);
 *   [CEReactions] undefined reset();
 *   boolean checkValidity();
 *   boolean reportValidity();
 * };
 */
export const htmlFormElementIDL = defineInterface({
  name: 'HTMLFormElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLFormElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['form'],
  members: [
    ctor([], xattr('HTMLConstructor')),
    roAttr('elements', reference(HTMLFormControlsCollectionImpl), xattr('SameObject')),
  ],
});
