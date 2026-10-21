import { InternalError } from '../../infra/internal-error';
import {
  arg, attr, defineInterface, idlType, impl, integer, nullable, op, reference, roAttr, xattr,
} from '../../web-idl/core/index';

import type { StyleletEnvironment } from '../environment';
import type { SelectorList } from '../selector/index';
import {
  CSSDeclarationBlock, type CustomPropertyRegistration, type PropertyDeclaration,
} from '../css/index';

import { CSSStylePropertiesImpl } from './style-properties';
import { CSSRuleListImpl } from './rule-list';
import { CSSRuleImpl } from './rule';
import type { CSSStyleSheetImpl } from './css-stylesheet';
import type { StylePropertyMapImpl } from './style-property-map';

/** A rule with a retained child-rule list and sheet associations shared through its subtree. */
// https://drafts.csswg.org/cssom/#the-cssgroupingrule-interface
export abstract class CSSGroupingRuleImpl extends CSSRuleImpl {
  /** Child rules in source order, retained across mutations of the grouping rule. */
  cssRules = new CSSRuleListImpl();

  /** Propagate sheet association through the retained child-rule tree. */
  override setParentStyleSheet(sheet: CSSStyleSheetImpl | null): void {
    super.setParentStyleSheet(sheet);
    for (const rule of this.cssRules) rule.setParentStyleSheet(sheet);
  }

  /** Nested rule insertion; currently throws until placement and recovery rules are implemented. */
  // https://drafts.csswg.org/cssom/#dom-cssgroupingrule-insertrule
  insertRule(_rule: string, _index?: number): number {
    // TODO: CSSOM's nested insertion, hierarchy checks, and declaration-rule fallback.
    return notImplemented('CSSGroupingRule.insertRule');
  }

  /** Nested rule removal; currently throws until its association updates are implemented. */
  // https://drafts.csswg.org/cssom/#dom-cssgroupingrule-deleterule
  deleteRule(_index: number): void {
    // TODO: CSSOM's nested rule removal and association updates.
    notImplemented('CSSGroupingRule.deleteRule');
  }
}

/** Parsed selectors, their leading declarations, and any nested child rules. */
// https://drafts.csswg.org/cssom/#the-cssstylerule-interface
export class CSSStyleRuleImpl extends CSSGroupingRuleImpl {
  /** Selectors used by matching, including parent bindings for a nested style rule. */
  selectors: SelectorList;
  /** Leading declarations owned by this rule; later declaration runs have separate child rules. */
  #style: CSSStylePropertiesImpl;

  /** Retain parsed selectors and establish this rule's declaration object. */
  constructor(
    selectors: SelectorList,
    declarations: PropertyDeclaration[],
    env: StyleletEnvironment,
  ) {
    super(env);
    this.selectors = selectors;
    this.#style = new CSSStylePropertiesImpl({
      block: new CSSDeclarationBlock(declarations),
      parentRule: this,
    }, env);
  }

  /** Rule serialization remains unimplemented; assignment has no effect. */
  // https://drafts.csswg.org/cssom/#dom-cssrule-csstext
  get cssText(): string {
    return notImplemented('CSSStyleRule.cssText');
  }

  set cssText(_value: string) {
    // https://drafts.csswg.org/cssom/#dom-cssrule-csstext
    // CSSRule.cssText assignment has no effect.
  }

  /** Historical STYLE_RULE code. */
  get type(): number {
    return 1;
  }

  /** Selector text access remains unimplemented until namespace-aware parsing and serialization are connected. */
  // https://drafts.csswg.org/cssom/#dom-cssstylerule-selectortext
  get selectorText(): string {
    // TODO: CSSOM selector serialization with the sheet's namespace context.
    return notImplemented('CSSStyleRule.selectorText');
  }

  set selectorText(_value: string) {
    // TODO: Parse selectors with the sheet's namespaces and enclosing rule.
    notImplemented('CSSStyleRule.selectorText');
  }

  /** Retained CSSOM declaration object for the leading declarations. */
  // https://drafts.csswg.org/cssom/#dom-cssstylerule-style
  get style(): CSSStylePropertiesImpl {
    return this.#style;
  }

  /** Typed OM view of the declarations; currently throws because typed maps are unimplemented. */
  // https://drafts.css-houdini.org/css-typed-om-1/#dom-cssstylerule-stylemap
  get styleMap(): StylePropertyMapImpl {
    return notImplemented('CSSStyleRule.styleMap');
  }
}

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

/** An @property rule backed by registration data; descriptor text and parsing remain unfinished. */
// https://drafts.css-houdini.org/css-properties-values-api-1/#the-csspropertyrule-interface
export class CSSPropertyRuleImpl extends CSSRuleImpl {
  /** Custom property's name, grammar, inheritance behavior, and initial value. */
  registration: CustomPropertyRegistration;

  /** Retain registration data supplied by the current direct-construction path. */
  constructor(registration: CustomPropertyRegistration, env: StyleletEnvironment) {
    super(env);
    this.registration = registration;
  }

  /** @property serialization remains unimplemented; assignment has no effect. */
  // https://drafts.csswg.org/cssom/#dom-cssrule-csstext
  get cssText(): string {
    return notImplemented('CSSPropertyRule.cssText');
  }

  set cssText(_value: string) {
    // CSSRule.cssText assignment has no effect.
  }

  /** Zero because @property has no historical CSSRule code. */
  get type(): number {
    return 0;
  }

  /** Registered custom-property name, including its leading double hyphen. */
  // https://drafts.css-houdini.org/css-properties-values-api-1/#dom-csspropertyrule-name
  get name(): string {
    return this.registration.name;
  }

  /** Syntax descriptor text; unavailable until parsing retains its original spelling. */
  // https://drafts.css-houdini.org/css-properties-values-api-1/#dom-csspropertyrule-syntax
  get syntax(): string {
    // TODO: retain the descriptor's original spelling when @property is parsed.
    return notImplemented('CSSPropertyRule.syntax');
  }

  /** Whether the registered property inherits by default. */
  // https://drafts.css-houdini.org/css-properties-values-api-1/#dom-csspropertyrule-inherits
  get inherits(): boolean {
    return this.registration.inherits;
  }

  /** Initial-value descriptor text; unavailable until parsing retains the optional descriptor. */
  // https://drafts.css-houdini.org/css-properties-values-api-1/#dom-csspropertyrule-initialvalue
  get initialValue(): string | null {
    // TODO: retain the optional descriptor independently of its registered value.
    return notImplemented('CSSPropertyRule.initialValue');
  }
}

/*
 * [Exposed=Window]
 * interface CSSGroupingRule : CSSRule {
 *   [SameObject] readonly attribute CSSRuleList cssRules;
 *   unsigned long insertRule(CSSOMString rule, optional unsigned long index = 0);
 *   undefined deleteRule(unsigned long index);
 * };
 */
export const cssGroupingRuleIDL = defineInterface({
  name: 'CSSGroupingRule', inherits: 'CSSRule', exposed: 'Window',
  implementation: impl(CSSGroupingRuleImpl),
  members: [
    roAttr('cssRules', reference(CSSRuleListImpl), xattr('SameObject')),
    op('insertRule', idlType.unsignedLong, [
      arg('rule', reference('CSSOMString')),
      arg('index', idlType.unsignedLong, { optional: true, default: integer(0) }),
    ]),
    op('deleteRule', idlType.undefined, [arg('index', idlType.unsignedLong)]),
  ],
});

/*
 * [Exposed=Window]
 * interface CSSStyleRule : CSSGroupingRule {
 *   attribute CSSOMString selectorText;
 *   [SameObject, PutForwards=cssText] readonly attribute CSSStyleProperties style;
 * };
 */
export const cssStyleRuleIDL = defineInterface({
  name: 'CSSStyleRule', inherits: 'CSSGroupingRule', exposed: 'Window',
  implementation: impl(CSSStyleRuleImpl),
  members: [
    attr('selectorText', reference('CSSOMString')),
    roAttr('style', reference(CSSStylePropertiesImpl), xattr('SameObject', ['PutForwards', 'cssText'])),
  ],
});

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

/*
 * [Exposed=Window]
 * interface CSSPropertyRule : CSSRule {
 *   readonly attribute CSSOMString name;
 *   readonly attribute CSSOMString syntax;
 *   readonly attribute boolean inherits;
 *   readonly attribute CSSOMString? initialValue;
 * };
 */
export const cssPropertyRuleIDL = defineInterface({
  name: 'CSSPropertyRule', inherits: 'CSSRule', exposed: 'Window',
  implementation: impl(CSSPropertyRuleImpl),
  members: [
    roAttr('name', reference('CSSOMString')),
    roAttr('syntax', reference('CSSOMString')),
    roAttr('inherits', idlType.boolean),
    roAttr('initialValue', nullable(reference('CSSOMString'))),
  ],
});

/** Report an explicitly unfinished CSSOM operation. */
function notImplemented(name: string): never {
  throw new InternalError(`${name} is not implemented`);
}
