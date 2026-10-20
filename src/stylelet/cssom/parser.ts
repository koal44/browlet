import { asciiLower } from '../../infra/ascii';
import { InternalError } from '../../infra/internal-error';

import type { StyleletEnvironment } from '../environment';
import {
  consumeBlock, discardRuleBlock,
  type Declaration, type StatementAtRule, type ComponentValue,
  type BlockContents, type ParsingContext, type TokenCursor, type Token,
} from '../syntax/index';
import { parseNestedSelectorList, parseSelectorList, type SelectorList } from '../selector/index';
import { interpretPropertyDeclaration, type PropertyDeclaration } from '../css/index';

import { CSSStyleRuleImpl, CSSNestedDeclarationsImpl } from './rules';
import type { CSSRuleImpl } from './rule';

/** One rule list's grammar and enclosing style, retaining the existing allocation owner. */
// https://drafts.csswg.org/css-syntax-3/#parser-algorithms
// The context is per parse, not a host facility on StyleletEnvironment. Each
// nested block selects its own context before any declarations are consumed.
export class CSSParsingContext implements ParsingContext<CSSRuleImpl, PropertyDeclaration> {
  env: StyleletEnvironment;

  #parentSelectors: SelectorList | null;
  #isConstructed: boolean;

  constructor(parentSelectors: SelectorList | null, isConstructed: boolean, env: StyleletEnvironment) {
    this.env = env;
    this.#parentSelectors = parentSelectors;
    this.#isConstructed = isConstructed;
  }

  /** Validate and interpret a property once, before declaration-versus-rule recovery. */
  interpretDeclaration(declaration: Declaration): PropertyDeclaration | null {
    return interpretPropertyDeclaration(declaration);
  }

  /** Select statement-at-rule interpretation with its enclosing context and earlier siblings. */
  // https://drafts.csswg.org/css-syntax-3/#consume-at-rule
  interpretStatementAtRule(
    rule: StatementAtRule,
    preceding: BlockContents<CSSRuleImpl, PropertyDeclaration>,
  ): CSSRuleImpl | null {
    switch (asciiLower(rule.name)) {
      case 'import':
        // https://drafts.csswg.org/cssom/#dom-cssstylesheet-insertrule
        // Replacement excludes imports too; one rejected rule fails insertion.
        if (this.#isConstructed || this.#parentSelectors !== null) return null;
        return this.#interpretStatementAtRule(rule, preceding);
      case 'namespace':
        if (this.#parentSelectors !== null) return null;
        return this.#interpretStatementAtRule(rule, preceding);
      case 'layer':
        return this.#interpretStatementAtRule(rule, preceding);
      default:
        // Unknown rules, including the former @charset rule, are invalid CSS.
        return null;
    }
  }

  /** Interpret a standard at-rule's prelude, placement, and entire block. */
  // https://drafts.csswg.org/css-syntax-3/#block-contents
  interpretBlockAtRule(
    name: string,
    prelude: ComponentValue[],
    preceding: BlockContents<CSSRuleImpl, PropertyDeclaration>,
    c: TokenCursor<Token>,
  ): CSSRuleImpl | null {
    switch (asciiLower(name)) {
      case 'media':
      case 'supports':
      case 'layer':
      case 'scope':
      case 'container':
      case 'font-face':
      case 'keyframes':
      case 'page':
      case 'property':
      case 'counter-style':
        return this.#interpretBlockAtRule(name, prelude, preceding, c);
      default:
        discardRuleBlock(c);
        return null;
    }
  }

  /** Interpret selectors, consume their property/nested-rule block, and construct the style rule. */
  // https://drafts.csswg.org/css-syntax-3/#style-rules
  interpretQualifiedRule(prelude: ComponentValue[], c: TokenCursor<Token>): CSSStyleRuleImpl | null {
    const selectors = this.#parentSelectors === null
      ? parseSelectorList(prelude)
      : parseNestedSelectorList(prelude, this.#parentSelectors);
    if (selectors === null) {
      discardRuleBlock(c);
      return null;
    }

    const context = new CSSParsingContext(selectors, this.#isConstructed, this.env);
    const contents = c.withContext(context, consumeBlock);
    return createStyleRule(selectors, contents, context);
  }

  /** Interpret a recognized statement; unlike unknown syntax, missing support is an implementation error. */
  // Rule-specific dependencies: css/ROADMAP.md#missing-rule-contracts
  #interpretStatementAtRule(
    rule: StatementAtRule,
    _preceding: BlockContents<CSSRuleImpl, PropertyDeclaration>,
  ): CSSRuleImpl | null {
    // TODO: Validate the named rule's prelude and placement, then construct its CSSOM rule.
    throw new InternalError(`@${rule.name} statement grammar and CSSOM construction are not implemented`);
  }

  /** Supply the named rule's grammar before entering its block, including descriptor/keyframe contexts. */
  // https://drafts.csswg.org/css-syntax-3/#block-contents
  #interpretBlockAtRule(
    name: string,
    _prelude: ComponentValue[],
    _preceding: BlockContents<CSSRuleImpl, PropertyDeclaration>,
    _c: TokenCursor<Token>,
  ): CSSRuleImpl | null {
    // TODO: Select this rule's child context, consume its block, validate, and construct its rule.
    // @font-face needs descriptors; @keyframes needs keyframe preludes, not selectors.
    throw new InternalError(`@${name} prelude, placement, and block grammar are not implemented`);
  }
}

/** Materialize validated declaration runs and child rules without interpreting their grammars again. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#style-rules
// CSS Nesting: https://drafts.csswg.org/css-nesting-1/#nested-declarations
function createStyleRule(
  selectors: SelectorList,
  contents: BlockContents<CSSRuleImpl, PropertyDeclaration>,
  context: CSSParsingContext,
): CSSStyleRuleImpl {
  const declarations: PropertyDeclaration[] = [];
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

  const rule = new CSSStyleRuleImpl(selectors, declarations, context.env);
  for (const child of children) child.parentRule = rule;
  rule.cssRules.replace(children);
  return rule;
}
