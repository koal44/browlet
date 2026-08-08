import type { PropertyDeclaration } from '../css/property';
import type { TreeScope } from '../css/tree-scope';
import type { StyleEngine } from './engine';
import type { StyleSheetAssociation } from './stylesheet-association';

export type CascadedProperty = {
  declaration: PropertyDeclaration;
  association: StyleSheetAssociation;
};

// TODO: Replace this provisional lookup with the CSS Cascade algorithm. It
// currently treats every top-level style rule as applicable and returns the
// first matching declaration without considering selectors or precedence.
export function getCascadedProperty(
  engine: StyleEngine,
  name: PropertyDeclaration['name'],
  treeScope: TreeScope = engine.treeScope,
): CascadedProperty | null {
  for (const association of engine.activeStyleSheets) {
    if (association.treeScope !== treeScope) continue;

    for (const rule of association.styleSheet.rules) {
      if (rule.type !== 'style-rule') continue;

      for (const item of rule.block) {
        if (item.type === 'property-declaration' && item.name === name) {
          return { declaration: item, association };
        }
      }
    }
  }

  return null;
}
