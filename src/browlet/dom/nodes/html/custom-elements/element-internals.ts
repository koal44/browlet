import { defineInterface, impl, nullable, reference, roAttr } from '../../../../../web-idl/index';

import { ElementAssociations, type ElementConstructor } from '../../../../html/reflection/index';
import type { BrowletEnvironment } from '../../../../environment';

import type { ElementImpl } from '../../element';
import type { ShadowRootImpl } from '../../shadow-root';
import type { HTMLElementImpl } from '../html-element';

/** Internal attribute defaults and element associations for one custom element. */
// https://html.spec.whatwg.org/multipage/custom-elements.html#the-elementinternals-interface
export class ElementInternalsImpl {
  /** Owning environment, retained when the target element is adopted. */
  env: BrowletEnvironment;
  /** Custom element whose internal content-attribute map supplies reflected defaults. */
  // https://html.spec.whatwg.org/multipage/custom-elements.html#internals-target
  targetElement: HTMLElementImpl;
  /** Internals' explicit associations are independent of the target element's associations. */
  #elementAssociations: ElementAssociations | undefined;

  /** Create internals after the owning HTMLElement has passed its attachment checks. */
  constructor(targetElement: HTMLElementImpl, env: BrowletEnvironment) {
    this.env = env;
    this.targetElement = targetElement;
  }

  /** Recognize the implementation independently of its platform object. */
  static is(value: unknown): value is ElementInternalsImpl {
    return value instanceof ElementInternalsImpl;
  }

  /** Return an available shadow root, including a closed root. */
  // https://html.spec.whatwg.org/multipage/custom-elements.html#dom-ElementInternals-shadowRoot
  get shadowRoot(): ShadowRootImpl | null {
    const shadow = this.targetElement.shadowRoot;
    return shadow?.availableToElementInternals ? shadow : null;
  }

  /** Read an internal attribute default, preserving absence as null. */
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#get-the-content-attribute
  getContentAttribute(name: string): string | null {
    return this.targetElement.internalContentAttributeMap?.get(name) ?? null;
  }

  /** Store an internal default without mutating DOM attributes or clearing explicit associations. */
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#set-the-content-attribute
  setContentAttribute(name: string, value: string): void {
    (this.targetElement.internalContentAttributeMap ??= new Map()).set(name, value);
  }

  /** Remove an internal default without running DOM attribute-change steps. */
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#delete-the-content-attribute
  deleteContentAttribute(name: string): void {
    this.targetElement.internalContentAttributeMap?.delete(name);
  }

  /** Read an internal associated target or target list, narrowed to the supplied implementation constructors. */
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#attr-associated-element
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#attr-associated-elements
  getAssociatedElements<T extends ElementImpl>(name: string, targetConstructors: ElementConstructor<T>[], isArray: false): T | null;
  getAssociatedElements<T extends ElementImpl>(name: string, targetConstructors: ElementConstructor<T>[], isArray: true): T[] | null;
  getAssociatedElements<T extends ElementImpl>(
    name: string, targetConstructors: ElementConstructor<T>[], isArray: boolean,
  ): T | T[] | null {
    const associations = this.#elementAssociations ??= new ElementAssociations();
    return associations.get(this.targetElement, name, this.getContentAttribute(name), targetConstructors, isArray);
  }

  /** Store a converted element or list without changing DOM attributes; null clears either assignment. */
  // https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflect
  setAssociatedElements(name: string, value: ElementImpl | ElementImpl[] | null): void {
    if (value === null) {
      this.#elementAssociations?.clear(name);
      this.deleteContentAttribute(name);
      return;
    }
    this.setContentAttribute(name, '');
    (this.#elementAssociations ??= new ElementAssociations()).set(name, value);
  }
}

// PROVISIONAL(HTML §4.13.7): HTMLElement.attachInternals() still needs custom-element
// definition lookup, disable-internals, construction-state, and single-attachment checks.
// TODO: Add form association/validation, CustomStateSet, and the ARIAMixin contribution.
/*
 * [Exposed=Window]
 * interface ElementInternals {
 *   readonly attribute ShadowRoot? shadowRoot;
 *   // Remaining members belong to the unfinished features listed above.
 * };
 */
export const elementInternalsIDL = defineInterface({
  name: 'ElementInternals',
  exposed: 'Window',
  implementation: impl(ElementInternalsImpl),
  members: [roAttr('shadowRoot', nullable(reference('ShadowRoot')))],
});
