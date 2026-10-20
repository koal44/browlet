import type { StyleletEnvironment } from '../environment';
import {
  parseStylesheetContents, type ParserInput, type Rule, type QualifiedRule,
} from '../syntax/index';
import { parseNestedSelectorList, parseSelectorList, type SelectorList } from '../selector/index';
import { interpretPropertyDeclarations, type PropertyDeclaration } from '../css/index';

import { CSSStyleRuleImpl, CSSNestedDeclarationsImpl } from './rules';
import type { CSSRuleImpl } from './rule';

/** Parse stylesheet contents into unattached rule implementations. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-stylesheet
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#css-stylesheets
// Combines syntax parsing and rule interpretation; callers create and attach the sheet.
export function parseCSSRules(input: ParserInput, env: StyleletEnvironment): CSSRuleImpl[] {
  const rules: CSSRuleImpl[] = [];
  for (const syntax of parseStylesheetContents(input)) {
    const rule = interpretCSSRule(syntax, env);
    if (rule !== null) rules.push(rule);
  }
  return rules;
}

/** Interpret a top-level syntax rule, discarding unsupported or invalid rules. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#css-stylesheets
// Extracted helper for the rule-interpretation step of parsing a CSS stylesheet.
export function interpretCSSRule(syntax: Rule, env: StyleletEnvironment): CSSRuleImpl | null {
  switch (syntax.type) {
    case 'qualified-rule': return interpretStyleRule(syntax, null, env);
    case 'statement-at-rule':
    case 'block-at-rule':
      // TODO: parse recognized at-rule grammars and construct their CSSOM implementations.
      return null;
  }
}

/** Interpret a qualified rule as a style rule, binding nested selectors to its selector list. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#style-rules
// CSS Nesting: https://drafts.csswg.org/css-nesting-1/#nested-declarations
// Extracted helper for style-rule interpretation and nested declaration placement.
function interpretStyleRule(
  syntax: QualifiedRule,
  parentSelectors: SelectorList | null,
  env: StyleletEnvironment,
): CSSStyleRuleImpl | null {
  const selectors = parentSelectors === null
    ? parseSelectorList(syntax.prelude)
    : parseNestedSelectorList(syntax.prelude, parentSelectors);
  if (selectors === null) return null;

  const declarations: PropertyDeclaration[] = [];
  const children: CSSRuleImpl[] = [];
  for (const item of syntax.block) {
    if (Array.isArray(item)) {
      const parsed = interpretPropertyDeclarations(item);
      if (children.length === 0) {
        for (const declaration of parsed) declarations.push(declaration);
      } else if (parsed.length > 0) {
        children.push(new CSSNestedDeclarationsImpl(parsed, env));
      }
    } else if (item.type === 'qualified-rule') {
      const nested = interpretStyleRule(item, selectors, env);
      if (nested !== null) children.push(nested);
    }
    // TODO: nested at-rules need their defining grammars and implementations.
  }

  const rule = new CSSStyleRuleImpl(selectors, declarations, env);
  for (const child of children) child.parentRule = rule;
  rule.cssRules.replace(children);
  return rule;
}
