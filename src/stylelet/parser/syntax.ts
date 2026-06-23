import { asciiLower } from '../../utils/css';
import { ComponentCursor } from './component-cursor';
import { TokenCursor } from './token-cursor';
import type {
  AtKeywordToken, DelimToken, DimensionToken, HashToken, IdentToken, NumberToken, PercentageToken, StaticToken, StringToken, Token, UrlToken,
} from './tokens';
import { tokenize, TokenKind } from './tokens';

export enum RuleKind {
  At = 1,
  Qualified,
}

export enum BlockKind {
  Brace = 1,
  Bracket,
  Parens,
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

export type ComponentValue =
  | PreservedToken
  | FunctionBlock
  | SimpleBlock;

export type PreservedToken =
  | IdentToken
  | AtKeywordToken
  | HashToken
  | StringToken
  | StaticToken<TokenKind.BadString>
  | UrlToken
  | StaticToken<TokenKind.BadUrl>
  | DelimToken
  | NumberToken
  | PercentageToken
  | DimensionToken
  | StaticToken<TokenKind.Whitespace>
  | StaticToken<TokenKind.CDO>
  | StaticToken<TokenKind.CDC>
  | StaticToken<TokenKind.Colon>
  | StaticToken<TokenKind.Semicolon>
  | StaticToken<TokenKind.Comma>
  | StaticToken<TokenKind.RightBracket>
  | StaticToken<TokenKind.RightParen>
  | StaticToken<TokenKind.RightBrace>;

export type FunctionBlock = {
  name: string;
  value: ComponentValue[];
};

export type SimpleBlock<K extends BlockKind = BlockKind> = {
  block: K;
  value: ComponentValue[];
};

export type BraceBlock = SimpleBlock<BlockKind.Brace>;
export type BracketBlock = SimpleBlock<BlockKind.Bracket>;
export type ParensBlock = SimpleBlock<BlockKind.Parens>;

export type Declaration = {
  name: string;
  value: ComponentValue[];
  important: boolean;
};

// 5.3.3. Parse a stylesheet
// Spec divergence: AST parser is string-only; source location belongs to the owning sheet/CSSOM layer.
export function parseStylesheet(input: string): StyleSheet {
  const tokens = tokenize(input);
  const rules = consumeListOfRules(new TokenCursor(tokens), true);

  return { rules };
}

// 5.3.4. Parse a list of rules
export function parseListOfRules(input: string): Rule[] {
  const tokens = tokenize(input);
  return consumeListOfRules(new TokenCursor(tokens), false);
}

// 5.3.5. Parse a rule
export function parseRule(input: string): Rule | null {
  const c = new TokenCursor(tokenize(input));

  consumeWhitespaceTokens(c);

  if (c.peek().kind === TokenKind.EOF) {
    return null;
  }

  const rule =
    c.peek().kind === TokenKind.AtKeyword
      ? consumeAtRule(c)
      : consumeQualifiedRule(c);

  if (rule === null) {
    return null;
  }

  consumeWhitespaceTokens(c);

  if (c.peek().kind !== TokenKind.EOF) {
    return null;
  }

  return rule;
}

function consumeWhitespaceTokens(c: TokenCursor): void {
  while (c.peek().kind === TokenKind.Whitespace) {
    c.next();
  }
}

// 5.3.6. Parse a declaration
export function parseDeclaration(input: string): Declaration | null {
  const c = new TokenCursor(tokenize(input));

  consumeWhitespaceTokens(c);

  if (c.peek().kind !== TokenKind.Ident) {
    return null;
  }

  const values: ComponentValue[] = [];

  while (c.peek().kind !== TokenKind.EOF) {
    values.push(consumeComponentValue(c));
  }

  return consumeDeclaration(new ComponentCursor(values));
}

export type StyleBlockItem = Declaration | Rule;
export type StyleBlockContents = StyleBlockItem[];

// 5.3.7. Parse a style block's contents
export function parseStyleBlockContents(input: string): StyleBlockContents {
  const c = new TokenCursor(tokenize(input));
  return consumeStyleBlockContents(c);
}

export type DeclarationOrAtRule = Declaration | AtRule;
export type DeclarationOrAtRuleList = DeclarationOrAtRule[];

// 5.3.8. Parse a list of declarations
export function parseListOfDeclarations(input: string): DeclarationOrAtRuleList {
  const c = new TokenCursor(tokenize(input));
  return consumeListOfDeclarations(c);
}

// 5.3.9. Parse a component value
export function parseComponentValue(input: string): ComponentValue | null {
  const c = new TokenCursor(tokenize(input));

  consumeWhitespaceTokens(c);

  if (c.peek().kind === TokenKind.EOF) {
    return null;
  }

  const value = consumeComponentValue(c);

  consumeWhitespaceTokens(c);

  if (c.peek().kind !== TokenKind.EOF) {
    return null;
  }

  return value;
}

// 5.3.10. Parse a list of component values
export function parseListOfComponentValues(input: string): ComponentValue[] {
  const c = new TokenCursor(tokenize(input));
  const values: ComponentValue[] = [];

  while (c.peek().kind !== TokenKind.EOF) {
    values.push(consumeComponentValue(c));
  }

  return values;
}

// 5.3.11. Parse a comma-separated list of component values
export function parseCommaSeparatedListOfComponentValues(input: string): ComponentValue[][] {
  const c = new TokenCursor(tokenize(input));
  const lists: ComponentValue[][] = [];

  while (true) {
    const values: ComponentValue[] = [];

    while (true) {
      const token = c.peek();

      if (token.kind === TokenKind.EOF) {
        lists.push(values);
        return lists;
      }

      if (token.kind === TokenKind.Comma) {
        c.next();
        lists.push(values);
        break;
      }

      values.push(consumeComponentValue(c));
    }
  }
}

// 5.4.1. Consume a list of rules
function consumeListOfRules(c: TokenCursor, topLevel: boolean): Rule[] {
  const rules: Rule[] = [];

  while (true) {
    const pos = c.pos();
    const token = c.next();

    if (token.kind === TokenKind.Whitespace) {
      continue;
    }

    if (token.kind === TokenKind.EOF) {
      return rules;
    }

    if (token.kind === TokenKind.CDO || token.kind === TokenKind.CDC) {
      if (topLevel) {
        continue;
      }

      c.restore(pos);

      const rule = consumeQualifiedRule(c);
      if (rule !== null) rules.push(rule);

      continue;
    }

    if (token.kind === TokenKind.AtKeyword) {
      c.restore(pos);
      rules.push(consumeAtRule(c));
      continue;
    }

    c.restore(pos);

    const rule = consumeQualifiedRule(c);
    if (rule !== null) rules.push(rule);
  }
}

// 5.4.2. Consume an at-rule
function consumeAtRule(c: TokenCursor): AtRule {
  const token = c.next();

  if (token.kind !== TokenKind.AtKeyword) {
    throw new Error('consumeAtRule called without an at-keyword token');
  }

  const rule: AtRule = {
    kind: RuleKind.At,
    name: token.value,
    prelude: [],
    block: null,
  };

  while (true) {
    const pos = c.pos();
    const next = c.next();

    if (next.kind === TokenKind.Semicolon) {
      return rule;
    }

    if (next.kind === TokenKind.EOF) {
      return rule;
    }

    if (next.kind === TokenKind.LeftBrace) {
      rule.block = consumeSimpleBlock(c, BlockKind.Brace);
      return rule;
    }

    c.restore(pos);
    rule.prelude.push(consumeComponentValue(c));
  }
}

// 5.4.3. Consume a qualified rule
function consumeQualifiedRule(c: TokenCursor): QualifiedRule | null {
  const prelude: ComponentValue[] = [];

  while (true) {
    const pos = c.pos();
    const token = c.next();

    if (token.kind === TokenKind.EOF) {
      return null;
    }

    if (token.kind === TokenKind.LeftBrace) {
      return {
        kind: RuleKind.Qualified,
        prelude,
        block: consumeSimpleBlock(c, BlockKind.Brace),
      };
    }

    c.restore(pos);
    prelude.push(consumeComponentValue(c));
  }
}

// 5.4.4. Consume a style block's contents
function consumeStyleBlockContents(c: TokenCursor): StyleBlockContents {
  const items: StyleBlockContents = [];

  while (true) {
    const pos = c.pos();
    const token = c.next();

    if (
      token.kind === TokenKind.Whitespace ||
      token.kind === TokenKind.Semicolon
    ) {
      continue;
    }

    if (token.kind === TokenKind.EOF) {
      return items;
    }

    if (token.kind === TokenKind.AtKeyword) {
      c.restore(pos);
      items.push(consumeAtRule(c));
      continue;
    }

    if (token.kind === TokenKind.Ident) {
      const temp: ComponentValue[] = [token];

      while (!isDeclarationEnd(c.peek())) {
        temp.push(consumeComponentValue(c));
      }

      const declaration = consumeDeclaration(new ComponentCursor(temp));
      if (declaration !== null) items.push(declaration);

      continue;
    }

    if (token.kind === TokenKind.Delim && token.value === '&') {
      c.restore(pos);

      const rule = consumeQualifiedRule(c);
      if (rule !== null) items.push(rule);

      continue;
    }

    c.restore(pos);

    while (!isDeclarationEnd(c.peek())) {
      consumeComponentValue(c);
    }
  }
}

// 5.4.5. Consume a list of declarations
function consumeListOfDeclarations(c: TokenCursor): DeclarationOrAtRuleList {
  const declarations: DeclarationOrAtRuleList = [];

  while (true) {
    const pos = c.pos();
    const token = c.next();

    if (
      token.kind === TokenKind.Whitespace ||
      token.kind === TokenKind.Semicolon
    ) {
      continue;
    }

    if (token.kind === TokenKind.EOF) {
      return declarations;
    }

    if (token.kind === TokenKind.AtKeyword) {
      c.restore(pos);
      declarations.push(consumeAtRule(c));
      continue;
    }

    if (token.kind === TokenKind.Ident) {
      const temp: ComponentValue[] = [token];

      while (!isDeclarationEnd(c.peek())) {
        temp.push(consumeComponentValue(c));
      }

      const declaration = consumeDeclaration(new ComponentCursor(temp));
      if (declaration !== null) declarations.push(declaration);

      continue;
    }

    c.restore(pos);

    while (!isDeclarationEnd(c.peek())) {
      consumeComponentValue(c);
    }
  }
}

// 5.4.6. Consume a declaration
function consumeDeclaration(c: ComponentCursor): Declaration | null {
  const comp = c.next();

  if (!isIdentToken(comp)) {
    throw new Error('consumeDeclaration called without an ident token');
  }

  const declaration: Declaration = {
    name: comp.value,
    value: [],
    important: false,
  };

  while (isTokenKind(c.peek(), TokenKind.Whitespace)) {
    c.next();
  }

  if (!isTokenKind(c.peek(), TokenKind.Colon)) {
    return null;
  }

  c.next();

  while (isTokenKind(c.peek(), TokenKind.Whitespace)) {
    c.next();
  }

  while (c.peek() !== null) {
    declaration.value.push(c.consume());
  }

  consumeImportantFlag(declaration);
  trimTrailingWhitespace(declaration.value);

  return declaration;
}

function consumeImportantFlag(declaration: Declaration): void {
  const value = declaration.value;

  const importantIndex = lastNonWhitespaceIndex(value, value.length - 1);
  if (importantIndex < 0) return;

  const bangIndex = lastNonWhitespaceIndex(value, importantIndex - 1);
  if (bangIndex < 0) return;

  const bang = value[bangIndex];
  const important = value[importantIndex];

  if (
    isDelimToken(bang, '!') &&
    isIdentToken(important) &&
    asciiLower(important.value) === 'important'
  ) {
    value.splice(bangIndex);
    declaration.important = true;
  }
}

function lastNonWhitespaceIndex(values: readonly ComponentValue[], start: number): number {
  for (let i = start; i >= 0; i--) {
    if (!isTokenKind(values[i], TokenKind.Whitespace)) {
      return i;
    }
  }

  return -1;
}

function trimTrailingWhitespace(values: ComponentValue[]): void {
  while (values.length > 0 && isTokenKind(values[values.length - 1], TokenKind.Whitespace)) {
    values.pop();
  }
}

// 5.4.7. Consume a component value
function consumeComponentValue(c: TokenCursor): ComponentValue {
  const token = c.next();

  if (token.kind === TokenKind.LeftBrace) {
    return consumeSimpleBlock(c, BlockKind.Brace);
  }

  if (token.kind === TokenKind.LeftBracket) {
    return consumeSimpleBlock(c, BlockKind.Bracket);
  }

  if (token.kind === TokenKind.LeftParen) {
    return consumeSimpleBlock(c, BlockKind.Parens);
  }

  if (token.kind === TokenKind.Function) {
    return consumeFunction(c, token.value);
  }

  if (!isPreservedToken(token)) {
    throw new Error('consumeComponentValue called at EOF or with a non-preserved token');
  }

  return token;
}

// 5.4.8. Consume a simple block
function consumeSimpleBlock<K extends BlockKind>(c: TokenCursor, block: K): SimpleBlock<K> {
  const result: SimpleBlock<K> = {
    block,
    value: [],
  };

  const ending = blockEndingTokenKind(block);

  while (true) {
    const pos = c.pos();
    const token = c.next();

    if (token.kind === ending) {
      return result;
    }

    if (token.kind === TokenKind.EOF) {
      return result;
    }

    c.restore(pos);
    result.value.push(consumeComponentValue(c));
  }
}

function blockEndingTokenKind(block: BlockKind): TokenKind {
  switch (block) {
    case BlockKind.Brace:
      return TokenKind.RightBrace;

    case BlockKind.Bracket:
      return TokenKind.RightBracket;

    case BlockKind.Parens:
      return TokenKind.RightParen;
  }
}

// 5.4.9. Consume a function
function consumeFunction(c: TokenCursor, name: string): FunctionBlock {
  const result: FunctionBlock = {
    name,
    value: [],
  };

  while (true) {
    const pos = c.pos();
    const token = c.next();

    if (token.kind === TokenKind.RightParen) {
      return result;
    }

    if (token.kind === TokenKind.EOF) {
      return result;
    }

    c.restore(pos);
    result.value.push(consumeComponentValue(c));
  }
}

type PreservedTokenKind = PreservedToken['kind'];

function isTokenKind<K extends PreservedTokenKind>(value: ComponentValue | null, kind: K): value is Extract<PreservedToken, { kind: K; }> {
  return value !== null && 'kind' in value && value.kind === kind;
}

function isIdentToken(value: ComponentValue | null): value is IdentToken {
  return value !== null && 'kind' in value && value.kind === TokenKind.Ident;
}

function isDelimToken(value: ComponentValue | null, delim: string): value is DelimToken {
  return (
    value !== null &&
    'kind' in value &&
    value.kind === TokenKind.Delim &&
    value.value === delim
  );
}

function isPreservedToken(token: Token): token is PreservedToken {
  return (
    token.kind !== TokenKind.Function &&
    token.kind !== TokenKind.LeftBrace &&
    token.kind !== TokenKind.LeftBracket &&
    token.kind !== TokenKind.LeftParen &&
    token.kind !== TokenKind.EOF
  );
}

function isDeclarationEnd(token: Token): token is StaticToken<TokenKind.Semicolon> | StaticToken<TokenKind.EOF> {
  return token.kind === TokenKind.Semicolon || token.kind === TokenKind.EOF;
}
