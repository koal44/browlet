import { CSSDeclarationBlock, CSSStylePropertiesImpl, type StyleletEnvironment } from '../../stylelet/index';

import type { ElementImpl } from '../dom/nodes/index';

/** Owns accepted inline declarations and lazily exposes their CSSOM object. */
// https://drafts.csswg.org/cssom/#elementcssinlinestyle
export class ElementCSSInlineStyleMixin {
  /** Element whose attribute input and CSSOM writes share these accepted declarations. */
  #element: ElementImpl;
  /** Owner supplying DOM operations for the lazily created declaration object. */
  #env: StyleletEnvironment;
  /** Accepted inline declarations, retained independently of the raw attribute. */
  #block?: CSSDeclarationBlock;
  /** Stable CSSStyleProperties implementation returned by the element's style getter. */
  #style?: CSSStylePropertiesImpl;

  /** Retain the owner without allocating a declaration or reading its attributes. */
  constructor(element: ElementImpl, env: StyleletEnvironment) {
    this.#element = element;
    this.#env = env;
  }

  /** Obtain the retained CSSOM object without reading or reparsing the attribute. */
  get style(): CSSStylePropertiesImpl {
    return this.#style ??= new CSSStylePropertiesImpl({
      block: this.#block ??= new CSSDeclarationBlock(),
      ownerNode: this.#element,
    }, this.#env);
  }

  /** Read accepted declarations without creating CSSOM or parsing the raw attribute. */
  getInlineStyleBlock(): CSSDeclarationBlock | null {
    return this.#block ?? null;
  }

  /** Check and apply attribute input, including the first assignment. */
  // https://html.spec.whatwg.org/multipage/dom.html#the-style-attribute
  attributeChanged(value: string | null): void {
    // CSSOM write-back has already updated the declaration; it bypasses CSP and parsing.
    if (this.#style?.updating) return;
    if (value === null) {
      this.#block?.clear();
    } else {
      // SPEC_CLASH(csp-blocked-style-attribute): Chromium/WebKit retain both the
      // raw attribute and prior accepted declarations; Firefox clears both.
      if (this.#element.nodeDocument.env.policyContainer.cspList!
        .isStyleAttributeBlocked(this.#element, value)) return;
      (this.#block ??= new CSSDeclarationBlock()).setText(value, { env: this.#env });
    }
  }
}
