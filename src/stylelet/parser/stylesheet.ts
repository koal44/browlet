import { Cursor } from '../../selectlet/parser/cursor';
import { consumeIdent, consumeTrivia } from '../../selectlet/parser/lex';
import {
  parseSelectorPrelude,
  type ParseContext as SelectorParseContext,
} from '../../selectlet/parser/parser';
import type { CustomPseudoPredicate } from '../../selectlet/selectlet';
import type { ColorSource, ColorValue } from './color';
import { ColorNameByText, ColorSourceKind, namedColorRgba } from './color';
import type { ColorDeclaration, RawDeclaration } from './types';
import {
  AtRuleKind, AtRuleKindByName, BlockItemKind, PropertyId, PropertyIdByName, RuleKind,
  type AtRule, type StyleBlock, type StyleRule, type Stylesheet, type CssRule,
  type InvalidRule, type StyleBlockItem, type Declaration, type InvalidBlockItem,
} from './types';

export type StyleParseContext = {
  pseudos?: Record<string, CustomPseudoPredicate>;
};

export function parseStylesheet(input: string, ctx: StyleParseContext = {}): Stylesheet {
  const c = new Cursor(input);
  const rules = parseRuleList(c, ctx);

  consumeTrivia(c);

  const ch = c.peek();
  if (ch) c.error(`Unexpected character ${ch}`);

  return { rules };
}

function parseRuleList(c: Cursor, ctx: StyleParseContext): CssRule[] {
  const rules: CssRule[] = [];

  while (true) {
    consumeTrivia(c);

    const ch = c.peek();
    if (!ch || ch === '}') break;

    rules.push(ch === '@' ? parseAtRule(c, ctx) : parseStyleRuleOrInvalid(c, ctx));
  }

  return rules;
}

function parseAtRule(c: Cursor, _ctx: StyleParseContext): AtRule {
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

function parseStyleRuleOrInvalid(c: Cursor, ctx: StyleParseContext): StyleRule | InvalidRule {
  const start = c.pos();

  try {
    return parseStyleRule(c, ctx);
  } catch (err) {
    c.restore(start);

    return {
      kind: RuleKind.Invalid,
      source: consumeInvalidQualifiedRule(c),
      reason: err instanceof Error ? err.message : undefined,
    };
  }
}

function parseStyleRule(c: Cursor, ctx: StyleParseContext): StyleRule {
  const selector = parseSelectorPrelude(c, selectorPreludeContext(ctx));

  consumeTrivia(c);

  return {
    kind: RuleKind.Style,
    selector,
    block: parseStyleBlock(c, ctx),
  };
}

function consumeInvalidQualifiedRule(c: Cursor): string {
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

    consumeComponentText(c);
  }
}

function consumeComponentText(c: Cursor): void {
  const ch = c.peek();

  if (!ch) return;

  if (ch === '/' && c.peek(1) === '*') {
    consumeTrivia(c);
    return;
  }

  if (ch === '"' || ch === "'") {
    consumeQuotedText(c);
    return;
  }

  if (ch === '(') {
    consumeBalancedText(c, '(', ')');
    return;
  }

  if (ch === '[') {
    consumeBalancedText(c, '[', ']');
    return;
  }

  if (ch === '{') {
    consumeRawBlock(c);
    return;
  }

  c.advance();
}

function consumeQuotedText(c: Cursor): void {
  const quote = c.next();

  while (!c.eof()) {
    const ch = c.next();

    if (ch === '\\' && !c.eof()) {
      c.advance();
      continue;
    }

    if (ch === quote) return;
  }
}

function consumeBalancedText(c: Cursor, open: string, close: string): void {
  if (c.peek() !== open) {
    c.error(`Expected ${open}, got ${c.peek() || '<eof>'}`);
  }

  c.advance();

  while (!c.eof()) {
    const ch = c.peek();

    if (ch === close) {
      c.advance();
      return;
    }

    // Do not eat the style block boundary while recovering an unclosed paren/bracket.
    if (ch === '}') {
      return;
    }

    consumeComponentText(c);
  }
}

function consumeInvalidDeclaration(c: Cursor): string {
  const start = c.pos();

  while (true) {
    const ch = c.peek();

    if (!ch || ch === '}') {
      return c.slice(start);
    }

    if (ch === ';') {
      c.advance();
      return c.slice(start);
    }

    consumeComponentText(c);
  }
}

function parseStyleBlock(c: Cursor, ctx: StyleParseContext): StyleBlock {
  if (c.peek() !== '{') {
    c.error(`Expected {, got ${c.peek() || '<eof>'}`);
  }

  c.advance();

  const items: StyleBlockItem[] = [];

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

    items.push(ch === '@' ? parseAtRule(c, ctx) : parseDeclarationOrInvalid(c, ctx));
  }

  return { items };
}

function parseDeclarationOrInvalid(c: Cursor, ctx: StyleParseContext): Declaration | InvalidBlockItem {
  const start = c.pos();

  try {
    return parseDeclaration(c, ctx);
  } catch (err) {
    c.restore(start);

    return {
      kind: BlockItemKind.Invalid,
      source: consumeInvalidDeclaration(c),
      reason: err instanceof Error ? err.message : undefined,
    };
  }
}

function parseDeclaration(c: Cursor, _ctx: StyleParseContext): Declaration {
  consumeTrivia(c);

  const name = consumeIdent(c);
  const prop = propertyIdForRawName(name);

  consumeTrivia(c);

  if (c.peek() !== ':') {
    c.error(`Expected : after declaration name, got ${c.peek() || '<eof>'}`);
  }

  c.advance();
  consumeTrivia(c);

  return parseDeclarationValue(c, prop, name);
}

function propertyIdForRawName(name: string): PropertyId {
  return PropertyIdByName[name.toLowerCase()] ?? PropertyId.Unknown;
}

function parseDeclarationValue(c: Cursor, prop: PropertyId, name: string): Declaration {
  switch (prop) {
    case PropertyId.Color:
    case PropertyId.BackgroundColor:
      return parseColorDeclaration(c, prop);

    default:
      return parseRawDeclarationValue(c, prop, name);
  }
}

function parseRawDeclarationValue(c: Cursor, prop: PropertyId, name: string): RawDeclaration {
  const value = consumeDeclarationValue(c);
  const parsed = stripImportant(value);

  if (c.peek() === ';') {
    c.advance();
  }

  return {
    kind: BlockItemKind.Declaration,
    raw: true,
    prop,
    name,
    value: parsed.value,
    important: parsed.important,
  };
}

function parseColorDeclaration(
  c: Cursor,
  prop: PropertyId.Color | PropertyId.BackgroundColor,
): ColorDeclaration {
  const value = parseColorValue(c);
  const important = finishDeclaration(c);

  return {
    kind: BlockItemKind.Declaration,
    prop,
    value,
    important,
  };
}

function parseColorValue(c: Cursor): ColorValue {
  const raw = consumeIdent(c);
  const text = raw.toLowerCase();

  if (text === 'currentcolor') {
    return {
      source: {
        kind: ColorSourceKind.CurrentColor,
      },
    };
  }

  const name = ColorNameByText[text];

  if (name === undefined) {
    c.error(`Expected color, got ${raw}`);
  }

  const source: ColorSource = {
    kind: ColorSourceKind.Named,
    name,
  };

  const rgba = namedColorRgba(name);

  return rgba === undefined ? { source } : { source, rgba };
}

function finishDeclaration(c: Cursor): boolean {
  const important = consumeImportant(c);

  consumeTrivia(c);

  const ch = c.peek();

  if (ch === ';') {
    c.advance();
    return important;
  }

  if (!ch || ch === '}') {
    return important;
  }

  c.error(`Expected declaration end, got ${ch}`);
}

function consumeDeclarationValue(c: Cursor): string {
  const start = c.pos();

  while (true) {
    const ch = c.peek();

    if (!ch || ch === ';' || ch === '}') {
      break;
    }

    consumeComponentText(c);
  }

  return c.slice(start, c.pos());
}

function consumeImportant(c: Cursor): boolean {
  const start = c.pos();

  consumeTrivia(c);

  if (c.peek() !== '!') {
    c.restore(start);
    return false;
  }

  c.advance();
  consumeTrivia(c);

  let ident = '';

  try {
    ident = consumeIdent(c);
  } catch {
    c.restore(start);
    return false;
  }

  if (ident.toLowerCase() !== 'important') {
    c.restore(start);
    return false;
  }

  return true;
}

function consumeAtRulePrelude(c: Cursor): string {
  let text = '';

  while (!c.eof()) {
    const ch = c.peek();

    if (ch === ';' || ch === '{') break;

    text += ch;
    c.advance();
  }

  return text;
}

function consumeRawBlock(c: Cursor): string {
  if (c.peek() !== '{') {
    c.error(`Expected block, got ${c.peek() || '<eof>'}`);
  }

  let text = '';
  let depth = 0;
  let quote = '';

  while (!c.eof()) {
    const ch = c.peek();

    text += ch;
    c.advance();

    if (quote) {
      if (ch === '\\' && !c.eof()) {
        text += c.peek();
        c.advance();
        continue;
      }

      if (ch === quote) {
        quote = '';
      }

      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === '{') {
      depth++;
      continue;
    }

    if (ch === '}') {
      depth--;

      if (depth === 0) {
        return text;
      }
    }
  }

  c.error('Unexpected EOF in block');
}

function selectorPreludeContext(ctx: StyleParseContext): SelectorParseContext {
  return ctx.pseudos ? { pseudos: ctx.pseudos } : {};
}

function stripImportant(value: string): { value: string; important: boolean; } {
  const trimmed = value.trim();
  const important = /!\s*important\s*$/i.test(trimmed);

  if (!important) {
    return { value: trimmed, important: false };
  }

  return {
    value: trimmed.replace(/!\s*important\s*$/i, '').trim(),
    important: true,
  };
}

