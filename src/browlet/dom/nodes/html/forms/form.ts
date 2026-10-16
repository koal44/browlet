import { HTML_NAMESPACE, InternalError } from '../../../../../infra/index';
import { defineInterface, impl, reference, roAttr, xattr } from '../../../../../web-idl/index';

import { defineElementInterface, type ElementImpl } from '../../element';
import { HTMLElementImpl } from '../html-element';
import { HTMLFormControlsCollectionImpl } from './form-controls-collection';

/** Form identity and ownership of its stable controls collection. */
// https://html.spec.whatwg.org/multipage/forms.html#htmlformelement
// PROVISIONAL: form-owner association, listed controls, submission/reset, and the remaining API await §4.10.
export class HTMLFormElementImpl extends HTMLElementImpl {
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

  /** Listed elements whose form owner is this form, in tree order, excluding image inputs. */
  // https://html.spec.whatwg.org/#dom-form-elements
  getListedElements(): ElementImpl[] {
    // TODO: Form-owner association must include external controls and form-associated custom elements.
    throw new InternalError('Form control membership requires form-owner association');
  }
}

/*
 * HTMLFormElement's implemented fragment:
 * [SameObject] readonly attribute HTMLFormControlsCollection elements;
 */
export const htmlFormElementIDL = defineInterface({
  name: 'HTMLFormElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLFormElementImpl),
  members: [roAttr('elements', reference(HTMLFormControlsCollectionImpl), xattr('SameObject'))],
});

export const htmlFormElementInterface = defineElementInterface({
  definition: htmlFormElementIDL,
  localNames: ['form'],
  namespaceURI: HTML_NAMESPACE,
});
