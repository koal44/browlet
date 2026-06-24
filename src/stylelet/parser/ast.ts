import {
  parseStyleBlockContents,
  parseStylesheet as parseSyntaxStylesheet,
  RuleKind as RuleKindSyntax,
  type AtRule as SyntaxAtRule,
  type BraceBlock,
  type QualifiedRule as SyntaxQualifiedRule,
  type Rule as SyntaxRule,
  type StyleBlockItem as SyntaxStyleBlockItem,
  type StyleSheet as SyntaxStyleSheet,
} from './syntax';
import {
  RuleKindAst,
  BlockItemAstKind,
  type AtRuleAst,
  type CssRuleAst,
  type NestedStyleRuleAst,
  type StyleBlockAst,
  type StyleBlockItemAst,
  type StyleRuleAst,
  type StyleSheetAst,
} from './types';
import { buildDeclarationAst } from './declaration';
import { assertNever } from '../../utils/util';

export type StyleParseContext = {
  // Keep this if other code expects it, but selector parsing is deferred.
  pseudos?: unknown;
};

export function parseStylesheet(input: string, ctx: StyleParseContext = {}): StyleSheetAst {
  return buildStyleSheetAst(parseSyntaxStylesheet(input), ctx);
}

export function buildStyleSheetAst(sheet: SyntaxStyleSheet, ctx: StyleParseContext = {}): StyleSheetAst {
  const rules: CssRuleAst[] = [];

  for (const rule of sheet.rules) {
    const ast = buildTopLevelRuleAst(rule, ctx);
    if (ast !== null) rules.push(ast);
  }

  return { rules };
}

function buildTopLevelRuleAst(rule: SyntaxRule, ctx: StyleParseContext): CssRuleAst | null {
  switch (rule.kind) {
    case RuleKindSyntax.Qualified:
      return buildStyleRuleAst(rule, ctx);

    case RuleKindSyntax.At:
      return buildAtRuleAst(rule, ctx);
  }
}

function buildStyleRuleAst(rule: SyntaxQualifiedRule, ctx: StyleParseContext): StyleRuleAst | null {
  return {
    kind: RuleKindAst.Style,
    selector: rule.prelude,
    block: buildStyleBlockAst(rule.block, ctx),
  };
}

function buildAtRuleAst(
  _rule: SyntaxAtRule,
  _ctx: StyleParseContext,
): AtRuleAst | null {
  // Strict transitional policy:
  // no at-rule grammars are implemented in the semantic AST yet.
  // Unknown, invalid, unsupported, and @charset at-rules are all dropped.
  return null;
}

function buildStyleBlockAst(block: BraceBlock, ctx: StyleParseContext): StyleBlockAst {
  const syntaxItems = parseStyleBlockContents(block.value);
  const items: StyleBlockItemAst[] = [];

  for (const item of syntaxItems) {
    const ast = buildStyleBlockItemAst(item, ctx);
    if (ast !== null) items.push(ast);
  }

  return { items };
}

function buildStyleBlockItemAst(item: SyntaxStyleBlockItem, ctx: StyleParseContext): StyleBlockItemAst | null {
  if ('value' in item) {
    return buildDeclarationAst(item);
  }

  switch (item.kind) {
    case RuleKindSyntax.At:
      return buildAtRuleAst(item, ctx);

    case RuleKindSyntax.Qualified:
      return buildNestedStyleRuleAst(item, ctx);

    default: assertNever(item);
  }
}

function buildNestedStyleRuleAst(rule: SyntaxQualifiedRule, ctx: StyleParseContext): NestedStyleRuleAst {
  return {
    kind: BlockItemAstKind.NestedStyle,
    selector: rule.prelude,
    block: buildStyleBlockAst(rule.block, ctx),
  };
}
