import { type BraceBlock, type ComponentValue } from './component-value';

export enum RuleKind {
  At = 1,
  Qualified,
}

export type StyleSheet = {
  rules: Rule[];
};

export type Rule =
  | AtRule
  | QualifiedRule;

export type AtRule = {
  kind: RuleKind.At;
  name: string;
  prelude: ComponentValue[];
  block: BraceBlock | null;
};

export type QualifiedRule = {
  kind: RuleKind.Qualified;
  prelude: ComponentValue[];
  block: BraceBlock;
};

export type Declaration = {
  name: string;
  value: ComponentValue[];
  important: boolean;
};

export type StyleBlockItem = Declaration | Rule;
export type StyleBlockContents = StyleBlockItem[];

export type DeclarationOrAtRule = Declaration | AtRule;
export type DeclarationOrAtRuleList = DeclarationOrAtRule[];
