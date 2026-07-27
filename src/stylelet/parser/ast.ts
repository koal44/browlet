import {
  parseStyleBlockContents, parseStylesheet as parseSyntaxStylesheet, RuleKind as RuleKindSyntax,
  type AtRule as SyntaxAtRule, type BraceBlock, type Declaration as SyntaxDeclaration,
  type QualifiedRule as SyntaxQualifiedRule, type Rule as SyntaxRule,
  type StyleBlockItem as SyntaxStyleBlockItem, type StyleSheet as SyntaxStyleSheet,
} from './syntax';
import {
  BlockItemAstKind, RuleKindAst, type AtRuleAst, type CssRuleAst, type NestedStyleRuleAst,
  type StyleBlockAst, type StyleBlockItemAst, type StyleRuleAst, type StyleSheetAst,
} from './types';
import { buildDeclarationAst } from './declaration';
import { assertNever } from '../../shared/util';
import { serializeComponentValues } from '../cssom/serialize';
import { parseSelectorList, type SelectorList } from './selectlet';

export function parseStylesheet(input: string): StyleSheetAst {
  return buildStyleSheetAst(parseSyntaxStylesheet(input));
}

export function buildStyleSheetAst(sheet: SyntaxStyleSheet): StyleSheetAst {
  const rules: CssRuleAst[] = [];

  for (const rule of sheet.rules) {
    const ast = buildTopLevelRuleAst(rule);
    if (ast !== null) rules.push(ast);
  }

  return { rules };
}

function buildTopLevelRuleAst(rule: SyntaxRule): CssRuleAst | null {
  switch (rule.kind) {
    case RuleKindSyntax.Qualified:
      return buildStyleRuleAst(rule);

    case RuleKindSyntax.At:
      return buildAtRuleAst(rule);
  }
}

function buildStyleRuleAst(rule: SyntaxQualifiedRule): StyleRuleAst | null {
  const selectorText = serializeComponentValues(rule.prelude);

  let selectorList: SelectorList | null;

  try {
    selectorList = parseSelectorList(rule.prelude);
  } catch {
    return null;
  }

  if (selectorList === null || selectorList.arms.length === 0) {
    return null;
  }

  return {
    kind: RuleKindAst.Style,
    selector: rule.prelude,
    selectorText,
    selectorList,
    block: buildStyleBlockAst(rule.block),
  };
}

function buildAtRuleAst(_rule: SyntaxAtRule): AtRuleAst | null {
  // Strict transitional policy:
  // no at-rule grammars are implemented in the semantic AST yet.
  // Unknown, invalid, unsupported, and @charset at-rules are all dropped.
  return null;
}

function buildStyleBlockAst(block: BraceBlock): StyleBlockAst {
  const syntaxItems = parseStyleBlockContents(block.value);
  const items: StyleBlockItemAst[] = [];

  for (const item of syntaxItems) {
    const ast = buildStyleBlockItemAst(item);
    if (ast !== null) items.push(ast);
  }

  return { items };
}

function buildStyleBlockItemAst(item: SyntaxStyleBlockItem): StyleBlockItemAst | null {
  if (isSyntaxDeclaration(item)) {
    return buildDeclarationAst(item);
  }

  switch (item.kind) {
    case RuleKindSyntax.At:
      return buildAtRuleAst(item);

    case RuleKindSyntax.Qualified:
      return buildNestedStyleRuleAst(item);

    default: assertNever(item);
  }
}

function buildNestedStyleRuleAst(rule: SyntaxQualifiedRule): NestedStyleRuleAst {
  return {
    kind: BlockItemAstKind.NestedStyle,
    selector: rule.prelude,
    block: buildStyleBlockAst(rule.block),
  };
}

function isSyntaxDeclaration(item: SyntaxStyleBlockItem): item is SyntaxDeclaration {
  return 'value' in item;
}
