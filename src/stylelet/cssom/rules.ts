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

/*
 * [Exposed=Window]
 * interface CSSGroupingRule : CSSRule {
 *   [SameObject] readonly attribute CSSRuleList cssRules;
 *   unsigned long insertRule(CSSOMString rule, optional unsigned long index = 0);
 *   undefined deleteRule(unsigned long index);
 * };
 */
export abstract class CSSGroupingRuleImpl extends CSSRuleImpl {
  cssRules = new CSSRuleListImpl();

  /** Propagate sheet association through the retained child-rule tree. */
  override setParentStyleSheet(sheet: CSSStyleSheetImpl | null): void {
    super.setParentStyleSheet(sheet);
    for (const rule of this.cssRules) rule.setParentStyleSheet(sheet);
  }

  insertRule(_rule: string, _index?: number): number {
    // TODO: CSSOM's nested insertion, hierarchy checks, and declaration-rule fallback.
    return notImplemented('CSSGroupingRule.insertRule');
  }

  deleteRule(_index: number): void {
    // TODO: CSSOM's nested rule removal and association updates.
    notImplemented('CSSGroupingRule.deleteRule');
  }
}

/*
 * [Exposed=Window]
 * interface CSSStyleRule : CSSGroupingRule {
 *   attribute CSSOMString selectorText;
 *   [SameObject, PutForwards=cssText] readonly attribute CSSStyleProperties style;
 * };
 */
export class CSSStyleRuleImpl extends CSSGroupingRuleImpl {
  selectors: SelectorList;
  #style: CSSStylePropertiesImpl;

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

  get cssText(): string {
    return notImplemented('CSSStyleRule.cssText');
  }

  set cssText(_value: string) {
    // https://drafts.csswg.org/cssom/#dom-cssrule-csstext
    // CSSRule.cssText assignment has no effect.
  }

  get type(): number {
    return 1;
  }

  get selectorText(): string {
    // TODO: CSSOM selector serialization with the sheet's namespace context.
    return notImplemented('CSSStyleRule.selectorText');
  }

  set selectorText(_value: string) {
    // TODO: Parse selectors with the sheet's namespaces and enclosing rule.
    notImplemented('CSSStyleRule.selectorText');
  }

  get style(): CSSStylePropertiesImpl {
    return this.#style;
  }

  get styleMap(): StylePropertyMapImpl {
    return notImplemented('CSSStyleRule.styleMap');
  }
}

// CSS Nesting, the CSSNestedDeclarations interface.
/*
 * [Exposed=Window]
 * interface CSSNestedDeclarations : CSSRule {
 *   [SameObject, PutForwards=cssText] readonly attribute CSSStyleProperties style;
 * };
 */
export class CSSNestedDeclarationsImpl extends CSSRuleImpl {
  #style: CSSStylePropertiesImpl;

  constructor(declarations: PropertyDeclaration[], env: StyleletEnvironment) {
    super(env);
    this.#style = new CSSStylePropertiesImpl({
      block: new CSSDeclarationBlock(declarations),
      parentRule: this,
    }, env);
  }

  get cssText(): string {
    return this.#style.cssText;
  }

  set cssText(_value: string) {
    // CSSRule.cssText assignment has no effect.
  }

  get type(): number {
    return 0;
  }

  get style(): CSSStylePropertiesImpl {
    return this.#style;
  }
}

// CSS Properties and Values API, the CSSPropertyRule interface.
/*
 * [Exposed=Window]
 * interface CSSPropertyRule : CSSRule {
 *   readonly attribute CSSOMString name;
 *   readonly attribute CSSOMString syntax;
 *   readonly attribute boolean inherits;
 *   readonly attribute CSSOMString? initialValue;
 * };
 */
export class CSSPropertyRuleImpl extends CSSRuleImpl {
  registration: CustomPropertyRegistration;

  constructor(registration: CustomPropertyRegistration, env: StyleletEnvironment) {
    super(env);
    this.registration = registration;
  }

  get cssText(): string {
    return notImplemented('CSSPropertyRule.cssText');
  }

  set cssText(_value: string) {
    // CSSRule.cssText assignment has no effect.
  }

  get type(): number {
    return 0;
  }

  get name(): string {
    return this.registration.name;
  }

  get syntax(): string {
    // TODO: retain the descriptor's original spelling when @property is parsed.
    return notImplemented('CSSPropertyRule.syntax');
  }

  get inherits(): boolean {
    return this.registration.inherits;
  }

  get initialValue(): string | null {
    // TODO: retain the optional descriptor independently of its registered value.
    return notImplemented('CSSPropertyRule.initialValue');
  }
}

// https://drafts.csswg.org/cssom/#the-cssgroupingrule-interface
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

// https://drafts.csswg.org/cssom/#the-cssstylerule-interface
export const cssStyleRuleIDL = defineInterface({
  name: 'CSSStyleRule', inherits: 'CSSGroupingRule', exposed: 'Window',
  implementation: impl(CSSStyleRuleImpl),
  members: [
    attr('selectorText', reference('CSSOMString')),
    roAttr('style', reference(CSSStylePropertiesImpl), xattr('SameObject', ['PutForwards', 'cssText'])),
  ],
});

// https://drafts.csswg.org/css-nesting-1/#cssnesteddeclarations
export const cssNestedDeclarationsIDL = defineInterface({
  name: 'CSSNestedDeclarations', inherits: 'CSSRule', exposed: 'Window',
  implementation: impl(CSSNestedDeclarationsImpl),
  members: [
    roAttr('style', reference(CSSStylePropertiesImpl), xattr('SameObject', ['PutForwards', 'cssText'])),
  ],
});

// https://drafts.css-houdini.org/css-properties-values-api-1/#the-csspropertyrule-interface
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
