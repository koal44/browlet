import type { PropertyDeclaration } from '../css/property';
import { matchSelectorList } from '../selector/match';
import type { Specificity } from '../syntax/selector';
import type { CSSStyleSheetImpl } from '../cssom/css-stylesheet';
import type { CascadeEngine } from './cascade-engine';
import type { DocumentOrShadowRootStyleState } from './document-or-shadow-root';

export type CascadedProperty = {
  declaration: PropertyDeclaration;
  styleSheet: CSSStyleSheetImpl;
  scope: DocumentOrShadowRootStyleState;
};

// This is the author-normal/important slice of cascade sorting. Origins,
// encapsulation context, layers, animations, and transitions enter here as
// their representations are added to the engine.
export function getCascadedProperty(
  engine: CascadeEngine,
  name: PropertyDeclaration['name'],
  state: DocumentOrShadowRootStyleState,
  element?: Element,
): CascadedProperty | null {
  let result: CascadedProperty | null = null;
  let resultSpecificity: Specificity | null = null;

  for (const styleSheet of engine.getActiveStyleSheets(state)) {
    for (const rule of styleSheet.__styleSheet.rules) {
      if (rule.type !== 'style-rule') continue;

      const specificity = element === undefined
        ? ZERO_SPECIFICITY
        : matchSelectorList(rule.selectors, element, engine.snapshot);
      if (specificity === null) continue;

      for (const item of rule.block) {
        if (item.type !== 'property-declaration' || item.name !== name) continue;
        if (
          result !== null &&
          comparePrecedence(
            item,
            specificity,
            result.declaration,
            resultSpecificity!,
          ) < 0
        ) continue;

        result = { declaration: item, styleSheet, scope: state };
        resultSpecificity = specificity;
      }
    }
  }

  return result;
}

function comparePrecedence(
  left: PropertyDeclaration,
  leftSpecificity: Specificity,
  right: PropertyDeclaration,
  rightSpecificity: Specificity,
): number {
  return Number(left.important) - Number(right.important) ||
    compareSpecificity(leftSpecificity, rightSpecificity);
}

function compareSpecificity(left: Specificity, right: Specificity): number {
  return left.a - right.a || left.b - right.b || left.c - right.c;
}

const ZERO_SPECIFICITY: Specificity = { a: 0, b: 0, c: 0 };
