import type { DOMElement as Element } from '../../infra/index';

import type { PropertyDeclaration } from '../props/index';
import { matchSelectorList, type Specificity } from '../selector/index';
import {
  CSSStyleRuleImpl, CSSNestedDeclarationsImpl, type CSSStyleSheetImpl,
} from '../cssom/index';

import type { CascadeEngine } from './cascade-engine';
import type { TreeScope } from './tree-scope';

export type CascadedProperty = {
  declaration: PropertyDeclaration;
  styleSheet: CSSStyleSheetImpl;
  scope: TreeScope;
};

/** Select a declaration from active sheets, optionally matching an element's selectors. */
// CSS Cascade: https://drafts.csswg.org/css-cascade-5/#cascade-sort
// This is the author-normal/important slice of cascade sorting. Origins,
// encapsulation context, layers, animations, and transitions enter here as
// their representations are added to the engine.
export function getCascadedProperty(
  engine: CascadeEngine,
  name: PropertyDeclaration['name'],
  scope: TreeScope,
  element?: Element,
): CascadedProperty | null {
  let result: CascadedProperty | null = null;
  let resultSpecificity: Specificity | null = null;

  for (const styleSheet of engine.getActiveStyleSheets(scope)) {
    for (const rule of styleSheet.ruleList) {
      if (!(rule instanceof CSSStyleRuleImpl)) continue;

      const specificity = element === undefined
        ? ZERO_SPECIFICITY
        : matchSelectorList(rule.selectors, element, engine.context);
      if (specificity === null) continue;

      const declaration = findRuleDeclaration(rule, name);
      if (declaration === undefined) continue;
      if (
        result !== null &&
        comparePrecedence(
          declaration,
          specificity,
          result.declaration,
          resultSpecificity!,
        ) < 0
      ) continue;

      result = { declaration, styleSheet, scope };
      resultSpecificity = specificity;
    }
  }

  return result;
}

/** Find the winning declaration in a rule's own blocks, including later declaration runs. */
// Implementation helper, combining these requirements rather than a named specification algorithm:
// CSS Cascade: https://drafts.csswg.org/css-cascade-5/#cascade-sort (importance and appearance order).
// CSS Nesting: https://drafts.csswg.org/css-nesting-1/#nested-declarations (parent matching/specificity).
function findRuleDeclaration(
  rule: CSSStyleRuleImpl,
  name: PropertyDeclaration['name'],
): PropertyDeclaration | undefined {
  let result = rule.style.getDeclaration(name);
  for (const child of rule.cssRules) {
    // TODO: cascade nested style/group rules using their own matching conditions.
    if (!(child instanceof CSSNestedDeclarationsImpl)) continue;
    const declaration = child.style.getDeclaration(name);
    if (declaration !== undefined &&
      (result === undefined || !result.important || declaration.important)) {
      result = declaration;
    }
  }
  return result;
}

/** Compare importance and specificity; the caller resolves ties by appearance order. */
// CSS Cascade: https://drafts.csswg.org/css-cascade-5/#cascade-sort
function comparePrecedence(
  left: PropertyDeclaration,
  leftSpecificity: Specificity,
  right: PropertyDeclaration,
  rightSpecificity: Specificity,
): number {
  return Number(left.important) - Number(right.important) ||
    compareSpecificity(leftSpecificity, rightSpecificity);
}

/** Compare selector specificity lexicographically. */
// Selectors: https://drafts.csswg.org/selectors-4/#specificity-rules
function compareSpecificity(left: Specificity, right: Specificity): number {
  return left.a - right.a || left.b - right.b || left.c - right.c;
}

const ZERO_SPECIFICITY: Specificity = { a: 0, b: 0, c: 0 };
