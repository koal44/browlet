import { consumeIdent, consumeTrivia, Cursor } from '../parser/lex';
import { parseSelectorPrelude, type ParseContext as SelectorParseContext } from '../../selectlet/parser/parser';
import type { CustomPseudoPredicate } from '../../selectlet/selectlet';
import { consumeComponentValue, consumeRawBlock } from './component';
import { parseDeclarationOrInvalid } from './declaration';
import {
  AtRuleKind, AtRuleKindByName, RuleKind,
  type AtRuleAst, type StyleBlockAst, type StyleRuleAst, type StyleSheetAst, type CssRuleAst,
  type InvalidRuleAst, type StyleBlockItemAst,
} from './types';

export type StyleParseContext = {
  pseudos?: Record<string, CustomPseudoPredicate>;
};

export function parseStylesheet(input: string, ctx: StyleParseContext = {}): StyleSheetAst {
  const c = new Cursor(input);
  const rules = parseRuleList(c, ctx);

  consumeTrivia(c);

  const ch = c.peek();
  if (ch) c.error(`Unexpected character ${ch}`);

  return { rules };
}

function parseRuleList(c: Cursor, ctx: StyleParseContext): CssRuleAst[] {
  const rules: CssRuleAst[] = [];

  while (true) {
    consumeTrivia(c);

    const ch = c.peek();
    if (!ch || ch === '}') break;

    rules.push(ch === '@' ? parseAtRule(c, ctx) : parseStyleRuleOrInvalid(c, ctx));
  }

  return rules;
}

function parseAtRule(c: Cursor, _ctx: StyleParseContext): AtRuleAst {
  if (c.peek() !== '@') {
    c.error(`Expected at-rule, got ${c.peek() || '<eof>'}`);
  }

  c.advance();

  const name = consumeIdent(c).toLowerCase();
  const prelude = consumeAtRulePrelude(c).trim();

  if (c.peek() === ';') {
    c.advance();

    return {
      kind: RuleKind.At,
      at: AtRuleKindByName[name] ?? AtRuleKind.Unknown,
      name,
      prelude,
    };
  }

  if (c.peek() === '{') {
    const block = consumeRawBlock(c);

    return {
      kind: RuleKind.At,
      at: AtRuleKindByName[name] ?? AtRuleKind.Unknown,
      name,
      prelude,
      block,
    };
  }

  c.error(`Expected ; or block after at-rule, got ${c.peek() || '<eof>'}`);
}

function parseStyleRuleOrInvalid(c: Cursor, ctx: StyleParseContext): StyleRuleAst | InvalidRuleAst {
  const start = c.pos();

  try {
    return parseStyleRule(c, ctx);
  } catch (err) {
    c.restore(start);

    return {
      kind: RuleKind.Invalid,
      source: consumeInvalidRule(c),
      reason: err instanceof Error ? err.message : undefined,
    };
  }
}

function parseStyleRule(c: Cursor, ctx: StyleParseContext): StyleRuleAst {
  const selector = parseSelectorPrelude(c, selectorPreludeContext(ctx));

  consumeTrivia(c);

  return {
    kind: RuleKind.Style,
    selector,
    block: parseStyleBlock(c, ctx),
  };
}

function parseStyleBlock(c: Cursor, ctx: StyleParseContext): StyleBlockAst {
  if (c.peek() !== '{') {
    c.error(`Expected {, got ${c.peek() || '<eof>'}`);
  }

  c.advance();

  const items: StyleBlockItemAst[] = [];

  while (true) {
    consumeTrivia(c);

    const ch = c.peek();

    if (!ch) {
      c.error('Unexpected EOF in style block');
    }

    if (ch === '}') {
      c.advance();
      break;
    }

    items.push(ch === '@' ? parseAtRule(c, ctx) : parseDeclarationOrInvalid(c));
  }

  return { items };
}

function consumeInvalidRule(c: Cursor): string {
  const start = c.pos();

  while (true) {
    const ch = c.peek();

    if (!ch) {
      return c.slice(start);
    }

    if (ch === '{') {
      consumeRawBlock(c);
      return c.slice(start);
    }

    consumeComponentValue(c);
  }
}

function consumeAtRulePrelude(c: Cursor): string {
  const start = c.pos();

  while (!c.eof()) {
    const ch = c.peek();

    if (ch === ';' || ch === '{') break;

    consumeComponentValue(c);
  }

  return c.slice(start, c.pos());
}

function selectorPreludeContext(ctx: StyleParseContext): SelectorParseContext {
  return ctx.pseudos ? { pseudos: ctx.pseudos } : {};
}
