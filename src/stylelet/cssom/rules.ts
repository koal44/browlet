import { InternalError } from '../../infra/internal-error';

import type { StyleletEnvironment } from '../environment';
import type { SelectorList } from '../selector/index';
import {
  CSSDeclarationBlock, type CustomPropertyRegistration, type PropertyDeclaration,
} from '../css/index';

import { CSSStyleDeclarationImpl } from './declaration';
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
  // TODO: connect CSSOM selectorText parsing and serialization to selectors.
  selectorText = '';

  #style: CSSStyleDeclarationImpl;

  constructor(
    selectors: SelectorList,
    declarations: PropertyDeclaration[],
    env: StyleletEnvironment,
  ) {
    super(env);
    this.selectors = selectors;
    // TODO: use CSSStylePropertiesImpl when its implementation is introduced.
    this.#style = new CSSStyleDeclarationImpl({
      block: new CSSDeclarationBlock(declarations),
      parentRule: this,
    }, env);
  }

  get cssText(): string {
    return notImplemented('CSSStyleRule.cssText');
  }

  set cssText(_value: string) {
    notImplemented('CSSStyleRule.cssText');
  }

  get type(): number {
    return 1;
  }

  get style(): CSSStyleDeclarationImpl {
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
  #style: CSSStyleDeclarationImpl;

  constructor(declarations: PropertyDeclaration[], env: StyleletEnvironment) {
    super(env);
    // TODO: use CSSStylePropertiesImpl when its implementation is introduced.
    this.#style = new CSSStyleDeclarationImpl({
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

  get style(): CSSStyleDeclarationImpl {
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

/** Report an explicitly unfinished CSSOM operation. */
function notImplemented(name: string): never {
  throw new InternalError(`${name} is not implemented`);
}
