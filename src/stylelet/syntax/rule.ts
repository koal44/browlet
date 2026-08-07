import { type ComponentValue } from './component-value';

export type StyleSheet = {
  rules: Rule[];
};

export type Rule =
  | AtRule
  | QualifiedRule
  | NestedDeclarationsRule;

export type AtRule =
  | StatementAtRule
  | BlockAtRule;

export type StatementAtRule = {
  kind: 'statement-at-rule';
  name: string;
  prelude: ComponentValue[];
};

export type BlockAtRule = {
  kind: 'block-at-rule';
  name: string;
  prelude: ComponentValue[];
  block: {
    declarations: Declaration[];
    rules: Rule[];
  };
};

export type QualifiedRule = {
  kind: 'qualified-rule';
  prelude: ComponentValue[];
  declarations: Declaration[];
  rules: Rule[];
};

export type NestedDeclarationsRule = {
  kind: 'nested-declarations-rule';
  declarations: Declaration[];
};

export type BlockContents = Array<Rule | Declaration[]>;

export type Declaration = {
  name: string;
  value: ComponentValue[];
  important: boolean;
  originalText?: string;
};
