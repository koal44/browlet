import { InternalError } from '../../../infra/internal-error';
import { attr, defineInterface, impl, reference, roAttr, xattr } from '../../../web-idl/core/index';

import type { StyleletEnvironment } from '../../environment';
import {
  consumeBlock,
  type BlockContents, type ParserInput, type Token, type TokenCursor,
} from '../../syntax/index';
import {
  parseNestedSelectorList, parseSelectorList, serializeSelectorList,
  type SelectorList, type SelectorNamespaces,
} from '../../selector/index';
import type { InterpretedDeclaration } from '../declarations/index';
import { CSSDeclarationBlock, CSSStylePropertiesImpl } from '../declarations/index';
import type { StylePropertyMapImpl } from '../typed/index';
import { RuleListContext } from './context';
import type { CSSRuleListImpl } from '../rule-list';

import type { CSSRuleImpl } from './rule';
import { CSSGroupingRuleImpl } from './grouping';
import { CSSNestedDeclarationsImpl } from './nested-declarations';

/** Parsed selectors, their leading declarations, and any nested child rules. */
// https://drafts.csswg.org/cssom/#the-cssstylerule-interface
export class CSSStyleRuleImpl extends CSSGroupingRuleImpl {
  /** Selectors used by matching, including parent bindings for a nested style rule. */
  selectors: SelectorList;
  /** Namespace bindings retained by the parsed selectors, including after detachment. */
  #selectorNamespaces: SelectorNamespaces;
  /** Leading declarations owned by this rule; later declaration runs have separate child rules. */
  #style: CSSStylePropertiesImpl;

  /** Retain parsed selectors and the supplied child list, and establish this rule's declaration object. */
  constructor(
    selectors: SelectorList,
    declarations: InterpretedDeclaration[],
    namespaces: SelectorNamespaces,
    cssRules: CSSRuleListImpl,
    env: StyleletEnvironment,
  ) {
    super(cssRules, env);
    this.selectors = selectors;
    this.#selectorNamespaces = namespaces;
    this.#style = new CSSStylePropertiesImpl({
      block: new CSSDeclarationBlock(declarations),
      parentRule: this,
    }, env);
  }

  /** Parse selectors with the rule list's namespace bindings and enclosing style rule. */
  // https://drafts.csswg.org/cssom/#parsing-selectors
  static parseSelectors(input: ParserInput, context: RuleListContext): SelectorList | null {
    return context.parentSelectors === null
      ? parseSelectorList(input, context)
      : parseNestedSelectorList(input, context.parentSelectors, context);
  }

  /** Consume the selected style rule's block using its supplied child list. */
  // https://drafts.csswg.org/css-syntax-3/#style-rules
  // SPEC_CLASH(css-style-rule-block-grammar): Use §7.1's <block-contents> and
  // CSS Nesting; §8.1 still says <declaration-list>, despite allowing nested rules.
  static interpret(
    selectors: SelectorList,
    c: TokenCursor<Token>,
    cssRules: CSSRuleListImpl,
    context: RuleListContext,
  ): CSSStyleRuleImpl {
    const childContext = new RuleListContext(cssRules, selectors, context.isConstructed, context.env);
    childContext.namespacePrefixes = context.namespacePrefixes;
    childContext.defaultNamespace = context.defaultNamespace;
    const contents = c.withContext(childContext, consumeBlock);
    return CSSStyleRuleImpl.fromContents(selectors, contents, childContext);
  }

  /** Assemble declarations and children into the context's supplied list without repeating grammar work. */
  // CSS Syntax: https://drafts.csswg.org/css-syntax-3/#style-rules
  // CSS Nesting: https://drafts.csswg.org/css-nesting-1/#nested-declarations
  static fromContents(selectors: SelectorList, contents: BlockContents, context: RuleListContext): CSSStyleRuleImpl {
    const declarations: InterpretedDeclaration[] = [];
    const children: CSSRuleImpl[] = [];
    let pendingDeclarations = declarations;
    // SPEC_CLASH(css-invalid-rule-declaration-runs): Follow browsers by merging
    // declarations across discarded rules; Syntax splits those runs.
    // https://github.com/w3c/csswg-drafts/issues/11271
    for (const item of contents) {
      if (Array.isArray(item)) {
        for (const declaration of item) {
          pendingDeclarations.push(declaration);
        }
      } else {
        if (children.length > 0 && pendingDeclarations.length > 0) {
          children.push(new CSSNestedDeclarationsImpl(pendingDeclarations, context.env));
        }
        children.push(item);
        pendingDeclarations = [];
      }
    }
    if (children.length > 0 && pendingDeclarations.length > 0) {
      children.push(new CSSNestedDeclarationsImpl(pendingDeclarations, context.env));
    }

    const namespaces = { namespacePrefixes: context.namespacePrefixes, defaultNamespace: context.defaultNamespace };
    const rule = new CSSStyleRuleImpl(selectors, declarations, namespaces, context.ruleList, context.env);
    for (const child of children) child.parentRule = rule;
    rule.cssRules.replace(children);
    return rule;
  }

  /** Serialize declarations and child rules in source order; assignment has no effect. */
  // https://drafts.csswg.org/cssom/#dom-cssrule-csstext
  get cssText(): string {
    const start = `${this.selectorText} {`;
    const declarations = this.#style.cssText;
    if (this.cssRules.length === 0) return declarations === '' ? `${start} }` : `${start} ${declarations} }`;
    let text = start;
    if (declarations !== '') text += `\n  ${declarations}`;
    for (const rule of this.cssRules) {
      const child = rule.cssText;
      if (child !== '') text += `\n  ${child}`;
    }
    return `${text}\n}`;
  }

  set cssText(_value: string) {
    // https://drafts.csswg.org/cssom/#dom-cssrule-csstext
    // CSSRule.cssText assignment has no effect.
  }

  /** Historical STYLE_RULE code. */
  get type(): number {
    return 1;
  }

  /** Canonical selectors; invalid assignments leave the rule and its declarations unchanged. */
  // https://drafts.csswg.org/cssom/#dom-cssstylerule-selectortext
  get selectorText(): string {
    return serializeSelectorList(this.selectors);
  }

  set selectorText(value: string) {
    const context = this.createRuleContext(this.parentRule);
    const selectors = context.parseSelectors(value);
    if (selectors === null) return;
    this.selectors = selectors;
    this.#selectorNamespaces = { namespacePrefixes: context.namespacePrefixes, defaultNamespace: context.defaultNamespace };
    this.#refreshNestedSelectors();
  }

  /** Retained CSSOM declaration object for the leading declarations. */
  // https://drafts.csswg.org/cssom/#dom-cssstylerule-style
  get style(): CSSStylePropertiesImpl {
    return this.#style;
  }

  /** Typed OM view of the declarations; currently throws because typed maps are unimplemented. */
  // https://drafts.css-houdini.org/css-typed-om-1/#dom-cssstylerule-stylemap
  get styleMap(): StylePropertyMapImpl {
    throw new InternalError('CSSStyleRule.styleMap is not implemented');
  }

  /** This style rule supplies the selectors against which its descendants nest. */
  override getNestingSelectors(): SelectorList {
    return this.selectors;
  }

  /** Rebind descendants to their parent's new selectors without replacing rule or declaration identities. */
  #refreshNestedSelectors(): void {
    for (const child of this.cssRules) {
      if (!(child instanceof CSSStyleRuleImpl)) continue;
      child.selectors = parseNestedSelectorList(child.selectorText, this.selectors, child.#selectorNamespaces)!;
      child.#refreshNestedSelectors();
    }
  }
}

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
