import { arg, defineInterface, idlType, impl, integer, op, reference, roAttr, xattr } from '../../../web-idl/core/index';

import type { StyleletEnvironment } from '../../environment';
import { RuleListContext } from './context';
import type { CSSRuleListImpl } from '../rule-list';
import type { CSSStyleSheetImpl } from '../css-stylesheet';

import { CSSRuleImpl } from './rule';

/** A rule with a retained child-rule list and sheet associations shared through its subtree. */
// https://drafts.csswg.org/cssom/#the-cssgroupingrule-interface
export abstract class CSSGroupingRuleImpl extends CSSRuleImpl {
  /** Child rules in source order, retained across mutations of the grouping rule. */
  cssRules: CSSRuleListImpl;

  /** Retain the concrete rule's child list and allocation owner. */
  constructor(cssRules: CSSRuleListImpl, env: StyleletEnvironment) {
    super(env);
    this.cssRules = cssRules;
  }

  /** Propagate sheet association through the retained child-rule tree. */
  override setParentStyleSheet(sheet: CSSStyleSheetImpl | null): void {
    super.setParentStyleSheet(sheet);
    for (const rule of this.cssRules) rule.setParentStyleSheet(sheet);
  }

  /** Insert a child rule or declaration run in this rule's namespace and nesting context. */
  // https://drafts.csswg.org/cssom/#dom-cssgroupingrule-insertrule
  insertRule(rule: string, index = 0): number {
    // SPEC_CLASH(detached-group-rule-insertion): CSSOM and Chromium/WebKit allow
    // detached groups to be edited; Firefox throws NS_ERROR_FAILURE.
    const context = this.createRuleContext(this);
    const child = this.cssRules.parseRuleForInsertion(rule, index, true, context);
    child.parentRule = this;
    child.setParentStyleSheet(this.parentStyleSheet);
    this.cssRules.insert(index, child);
    return index;
  }

  /** Remove a child rule and detach its subtree from the containing sheet. */
  // https://drafts.csswg.org/cssom/#dom-cssgroupingrule-deleterule
  deleteRule(index: number): void {
    this.cssRules.remove(index);
  }

  /** Select the enclosing style and current sheet namespaces for an insertion or selector edit. */
  protected createRuleContext(parent: CSSRuleImpl | null): RuleListContext {
    const context = new RuleListContext(this.cssRules, parent?.getNestingSelectors() ?? null, false, this.env);
    context.useNamespaces(this.parentStyleSheet);
    return context;
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
    roAttr('cssRules', reference('CSSRuleList'), xattr('SameObject')),
    op('insertRule', idlType.unsignedLong, [
      arg('rule', reference('CSSOMString')),
      arg('index', idlType.unsignedLong, { optional: true, default: integer(0) }),
    ]),
    op('deleteRule', idlType.undefined, [arg('index', idlType.unsignedLong)]),
  ],
});
