import { defineInterface, impl, reference, roAttr, xattr } from '../../../web-idl/core/index';

import type { StyleletEnvironment } from '../../environment';
import type { PropertyDeclaration } from '../../props/index';
import { CSSDeclarationBlock, CSSStylePropertiesImpl } from '../declarations/index';

import { CSSRuleImpl } from './rule';

/** A declaration run kept in source order among a containing rule's nested children. */
// https://drafts.csswg.org/css-nesting-1/#cssnesteddeclarations
export class CSSNestedDeclarationsImpl extends CSSRuleImpl {
  /** Declarations in this run, separate from the parent style rule's leading declarations. */
  #style: CSSStylePropertiesImpl;

  /** Establish a declaration object owned by this nested-declarations rule. */
  constructor(declarations: PropertyDeclaration[], env: StyleletEnvironment) {
    super(env);
    this.#style = new CSSStylePropertiesImpl({
      block: new CSSDeclarationBlock(declarations),
      parentRule: this,
    }, env);
  }

  /** Serialized declaration run; assignment has no effect. */
  // https://drafts.csswg.org/cssom/#dom-cssrule-csstext
  get cssText(): string {
    return this.#style.cssText;
  }

  set cssText(_value: string) {
    // CSSRule.cssText assignment has no effect.
  }

  /** Zero because nested-declarations rules have no historical CSSRule code. */
  get type(): number {
    return 0;
  }

  /** Retained CSSOM declaration object for this run. */
  // https://drafts.csswg.org/css-nesting-1/#dom-cssnesteddeclarations-style
  get style(): CSSStylePropertiesImpl {
    return this.#style;
  }
}

/*
 * [Exposed=Window]
 * interface CSSNestedDeclarations : CSSRule {
 *   [SameObject, PutForwards=cssText] readonly attribute CSSStyleProperties style;
 * };
 */
export const cssNestedDeclarationsIDL = defineInterface({
  name: 'CSSNestedDeclarations', inherits: 'CSSRule', exposed: 'Window',
  implementation: impl(CSSNestedDeclarationsImpl),
  members: [
    roAttr('style', reference(CSSStylePropertiesImpl), xattr('SameObject', ['PutForwards', 'cssText'])),
  ],
});
