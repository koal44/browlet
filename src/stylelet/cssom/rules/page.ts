import { InternalError } from '../../../infra/internal-error';
import { annotated, attr, defineInterface, impl, reference, roAttr, xattr } from '../../../web-idl/core/index';

import type { StyleletEnvironment } from '../../environment';
import type { BlockContents, ComponentValue, Token, TokenCursor, TokenList } from '../../syntax/index';
import { CSSStyleDeclarationImpl } from '../declarations/index';
import type { RuleListContext } from './context';
import type { CSSRuleListImpl } from '../rule-list';

import { CSSGroupingRuleImpl } from './grouping';

/** Page-rule boundary awaiting page-selector and descriptor grammars. */
// https://drafts.csswg.org/cssom/#the-csspagerule-interface
export class CSSPageRuleImpl extends CSSGroupingRuleImpl {
  /** Page rules cannot yet be built from ordinary element-property declarations. */
  constructor(cssRules: CSSRuleListImpl, env: StyleletEnvironment) {
    super(cssRules, env);
    throw new InternalError('Page selector and descriptor parsing are not implemented');
  }

  /** Consume page selectors, descriptors, and margin rules with the page-specific grammar. */
  // https://drafts.csswg.org/css-page-3/#syntax-page-selector
  static interpret(
    _prelude: TokenList<ComponentValue>,
    _preceding: BlockContents | null,
    _c: TokenCursor<Token>,
    _cssRules: CSSRuleListImpl,
    _context: RuleListContext,
  ): CSSPageRuleImpl | null {
    // TODO: Supply page-selector/descriptor consumers, then construct CSSPageRuleImpl.
    // Ordinary element selectors and the property registry are not this rule's grammar.
    throw new InternalError('Page selector, descriptor, and margin-rule parsing are not implemented');
  }

  /** Page-rule serialization depends on the missing page-selector/descriptor representation. */
  // https://drafts.csswg.org/cssom/#serialize-a-css-rule
  // SPEC_GAP(page-rule-serialization): CSSOM leaves this serializer as an editorial issue.
  get cssText(): string {
    throw new InternalError('CSSPageRule serialization is not implemented');
  }

  set cssText(_value: string) {}

  /** Historical PAGE_RULE code. */
  get type(): number { return 6; }

  /** Page selectors use their own grammar, not ordinary element selectors. */
  // SPEC_GAP(page-selector-algorithms): CSSOM names parsing/serialization algorithms but leaves their steps undefined.
  get selectorText(): string {
    throw new InternalError('Page selector serialization is not implemented');
  }

  set selectorText(_value: string) {
    throw new InternalError('Page selector parsing is not implemented');
  }

  /** Page descriptors must be retained with this rule as parent and no owner node. */
  get style(): CSSPageDescriptorsImpl {
    throw new InternalError('Page descriptor storage is not implemented');
  }
}

/*
 * [Exposed=Window]
 * interface CSSPageRule : CSSGroupingRule {
 *   attribute CSSOMString selectorText;
 *   [SameObject, PutForwards=cssText] readonly attribute CSSPageDescriptors style;
 * };
 */
export const cssPageRuleIDL = defineInterface({
  name: 'CSSPageRule', inherits: 'CSSGroupingRule', exposed: 'Window',
  implementation: impl(CSSPageRuleImpl),
  members: [
    attr('selectorText', reference('CSSOMString')),
    roAttr('style', reference('CSSPageDescriptors'), xattr('SameObject', ['PutForwards', 'cssText'])),
  ],
});

/** Page descriptor declaration object; unavailable until the descriptor grammar is supplied. */
// https://drafts.csswg.org/cssom/#csspagedescriptors
export class CSSPageDescriptorsImpl extends CSSStyleDeclarationImpl {
  /** Prevent inherited element-property parsing from masquerading as page-descriptor support. */
  constructor(parentRule: CSSPageRuleImpl, env: StyleletEnvironment) {
    super({ parentRule }, env);
    throw new InternalError('Page descriptor parsing and mutation are not implemented');
  }
}

/*
 * [Exposed=Window]
 * interface CSSPageDescriptors : CSSStyleDeclaration {
 *   attribute [LegacyNullToEmptyString] CSSOMString margin;
 *   attribute [LegacyNullToEmptyString] CSSOMString marginTop;
 *   attribute [LegacyNullToEmptyString] CSSOMString marginRight;
 *   attribute [LegacyNullToEmptyString] CSSOMString marginBottom;
 *   attribute [LegacyNullToEmptyString] CSSOMString marginLeft;
 *   attribute [LegacyNullToEmptyString] CSSOMString margin-top;
 *   attribute [LegacyNullToEmptyString] CSSOMString margin-right;
 *   attribute [LegacyNullToEmptyString] CSSOMString margin-bottom;
 *   attribute [LegacyNullToEmptyString] CSSOMString margin-left;
 *   attribute [LegacyNullToEmptyString] CSSOMString size;
 *   attribute [LegacyNullToEmptyString] CSSOMString pageOrientation;
 *   attribute [LegacyNullToEmptyString] CSSOMString page-orientation;
 *   attribute [LegacyNullToEmptyString] CSSOMString marks;
 *   attribute [LegacyNullToEmptyString] CSSOMString bleed;
 * };
 */
export const cssPageDescriptorsIDL = defineInterface({
  name: 'CSSPageDescriptors', inherits: 'CSSStyleDeclaration', exposed: 'Window',
  implementation: impl(CSSPageDescriptorsImpl),
  members: [
    'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'size', 'pageOrientation', 'page-orientation', 'marks', 'bleed',
  ].map((name) => {
    const property = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    return attr(name, annotated(reference('CSSOMString'), xattr('LegacyNullToEmptyString')), {
      get() { return (this as CSSPageDescriptorsImpl).getPropertyValue(property); },
      set(_env, value) { (this as CSSPageDescriptorsImpl).setProperty(property, value as string); },
    });
  }),
});

