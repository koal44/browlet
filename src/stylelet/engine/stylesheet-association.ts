import type { StyleSheet } from '../css/stylesheet';
import type { TreeScope } from '../css/tree-scope';

/** An active use of a stylesheet within one document or shadow-tree scope. */
export type StyleSheetAssociation = {
  styleSheet: StyleSheet;
  treeScope: TreeScope;
};
