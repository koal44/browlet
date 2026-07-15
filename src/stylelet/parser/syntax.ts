import { asciiLower } from '../../shared/css';
import { ComponentCursor } from './component-cursor';
import { isBad, type TryComponentConsumerResult, type TryComponentConsumer } from './component-try-consumer';
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
  Function,
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
  | ComponentBlock;

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

export type ComponentBlock =
  | SimpleBlock
  | FunctionBlock;

export type SimpleBlock<K extends SimpleBlockKind = SimpleBlockKind> = {
  block: K;
  value: ComponentValue[];
};

export type SimpleBlockKind =
  | BlockKind.Brace
  | BlockKind.Bracket
  | BlockKind.Parens;

export type FunctionBlock = {
  block: BlockKind.Function;
  name: string;
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

export type ParserInput = string | readonly ComponentValue[];

// 5.3.1. Parse something according to a CSS grammar
export function parseAsComponentGrammar<T>(
  input: ParserInput,
  consumer: TryComponentConsumer<T>,
  context: unknown = undefined,
): TryComponentConsumerResult<T> {
  const components = parseListOfComponentValues(input);
  const c = new ComponentCursor(components, { context });
  const result = consumer(c);

  if (result === null) {
    return null;
  }

  if (isBad(result)) {
    return result;
  }

  consumeComponentTrivia(c);

  if (c.peek() !== null) {
    return null;
  }

  return result;
}

// 5.3.2. Parse a comma-separated list according to a CSS grammar
export function parseListAsComponentGrammar<T>(
  input: ParserInput,
  consumer: TryComponentConsumer<T>,
  context: unknown = undefined,
): (TryComponentConsumerResult<T>)[] {
  const lists = parseCommaSeparatedListOfComponentValues(input);

  if (lists.length === 1 && lists[0]!.every(isWhitespaceToken)) {
    return [];
  }

  return lists.map((item) => parseAsComponentGrammar(item, consumer, context));
}

// 5.3.3. Parse a stylesheet
// Spec divergence: AST parser is string-only; source location belongs to the owning sheet/CSSOM layer.
export function parseStylesheet(input: string): StyleSheet {
  const tokens = tokenize(input);
  const rules = consumeListOfRulesFromTokens(new TokenCursor(tokens), true);

  return { rules };
}

// 5.3.4. Parse a list of rules
export function parseListOfRules(input: string): Rule[] {
  const tokens = tokenize(input);
  return consumeListOfRulesFromTokens(new TokenCursor(tokens), false);
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
      ? consumeAtRuleFromTokens(c)
      : consumeQualifiedRuleFromTokens(c);

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
export function parseDeclaration(
  input: string,
  context: unknown = undefined
): Declaration | null {
  const c = new TokenCursor(tokenize(input));

  consumeWhitespaceTokens(c);

  if (c.peek().kind !== TokenKind.Ident) {
    return null;
  }

  const values: ComponentValue[] = [];

  while (c.peek().kind !== TokenKind.EOF) {
    values.push(consumeComponentValueFromTokens(c));
  }

  return consumeDeclarationFromComponents(new ComponentCursor(values, { context }));
}

export type StyleBlockItem = Declaration | Rule;
export type StyleBlockContents = StyleBlockItem[];

// 5.3.7. Parse a style block's contents
export function parseStyleBlockContents(
  input: ParserInput,
  context: unknown = undefined,
): StyleBlockContents {
  const components = parseListOfComponentValues(input);
  return consumeStyleBlockContentsFromComponents(new ComponentCursor(components, { context }));
}

export type DeclarationOrAtRule = Declaration | AtRule;
export type DeclarationOrAtRuleList = DeclarationOrAtRule[];

// 5.3.8. Parse a list of declarations
export function parseListOfDeclarations(input: string): DeclarationOrAtRuleList {
  const c = new TokenCursor(tokenize(input));
  return consumeListOfDeclarationsFromTokens(c);
}

// 5.3.9. Parse a component value
export function parseComponentValue(input: string): ComponentValue | null {
  const c = new TokenCursor(tokenize(input));

  consumeWhitespaceTokens(c);

  if (c.peek().kind === TokenKind.EOF) {
    return null;
  }

  const value = consumeComponentValueFromTokens(c);

  consumeWhitespaceTokens(c);

  if (c.peek().kind !== TokenKind.EOF) {
    return null;
  }

  return value;
}

// 5.3.10. Parse a list of component values
export function parseListOfComponentValues(input: ParserInput): readonly ComponentValue[] {
  if (typeof input !== 'string') {
    return input;
  }

  const c = new TokenCursor(tokenize(input));
  const values: ComponentValue[] = [];

  while (c.peek().kind !== TokenKind.EOF) {
    values.push(consumeComponentValueFromTokens(c));
  }

  return values;
}

// 5.3.11. Parse a comma-separated list of component values
export function parseCommaSeparatedListOfComponentValues(
  input: string | readonly ComponentValue[],
): ComponentValue[][] {
  const lists: ComponentValue[][] = [];

  if (typeof input === 'string') {
    const c = new TokenCursor(tokenize(input));

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

        values.push(consumeComponentValueFromTokens(c));
      }
    }
  } else {
    const c = new ComponentCursor(input);

    while (true) {
      const values: ComponentValue[] = [];

      while (true) {
        const component = c.peek();

        if (component === null) {
          lists.push(values);
          return lists;
        }

        if (isTokenKind(component, TokenKind.Comma)) {
          c.next();
          lists.push(values);
          break;
        }

        values.push(c.consume());
      }
    }
  }
}

// 5.4.1. Consume a list of rules
function consumeListOfRulesFromTokens(c: TokenCursor, topLevel: boolean): Rule[] {
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

      const rule = consumeQualifiedRuleFromTokens(c);
      if (rule !== null) rules.push(rule);

      continue;
    }

    if (token.kind === TokenKind.AtKeyword) {
      c.restore(pos);
      rules.push(consumeAtRuleFromTokens(c));
      continue;
    }

    c.restore(pos);

    const rule = consumeQualifiedRuleFromTokens(c);
    if (rule !== null) rules.push(rule);
  }
}

// 5.4.2. Consume an at-rule
function consumeAtRuleFromTokens(c: TokenCursor): AtRule {
  const token = c.next();

  if (token.kind !== TokenKind.AtKeyword) {
    throw new Error('consumeAtRuleFromTokens called without an at-keyword token');
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
      rule.block = consumeSimpleBlockFromTokens(c, BlockKind.Brace);
      return rule;
    }

    c.restore(pos);
    rule.prelude.push(consumeComponentValueFromTokens(c));
  }
}

function consumeAtRuleFromComponents(c: ComponentCursor): AtRule {
  const at = c.consume();

  if (!isTokenKind(at, TokenKind.AtKeyword)) {
    c.error('Expected at-keyword');
  }

  const rule: AtRule = {
    kind: RuleKind.At,
    name: at.value,
    prelude: [],
    block: null,
  };

  while (true) {
    const comp = c.peek();

    if (comp === null) {
      return rule;
    }

    if (isTokenKind(comp, TokenKind.Semicolon)) {
      c.next();
      return rule;
    }

    if (isBraceBlock(comp)) {
      c.next();
      rule.block = comp;
      return rule;
    }

    rule.prelude.push(c.consume());
  }
}

// 5.4.3. Consume a qualified rule
function consumeQualifiedRuleFromTokens(c: TokenCursor): QualifiedRule | null {
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
        block: consumeSimpleBlockFromTokens(c, BlockKind.Brace),
      };
    }

    c.restore(pos);
    prelude.push(consumeComponentValueFromTokens(c));
  }
}

function consumeQualifiedRuleFromComponents(c: ComponentCursor): QualifiedRule | null {
  const prelude: ComponentValue[] = [];

  while (true) {
    const comp = c.peek();

    if (comp === null) {
      return null;
    }

    if (isBraceBlock(comp)) {
      c.next();

      return {
        kind: RuleKind.Qualified,
        prelude,
        block: comp,
      };
    }

    prelude.push(c.consume());
  }
}

// 5.4.4. Consume a style block's contents
function consumeStyleBlockContentsFromComponents(c: ComponentCursor): StyleBlockContents {
  const items: StyleBlockContents = [];

  while (true) {
    consumeComponentTriviaAndSemicolons(c);

    const comp = c.peek();

    if (comp === null) {
      return items;
    }

    if (isTokenKind(comp, TokenKind.AtKeyword)) {
      items.push(consumeAtRuleFromComponents(c));
      continue;
    }

    if (isIdentToken(comp)) {
      const temp: ComponentValue[] = [];

      while (!isComponentDeclarationEnd(c.peek())) {
        temp.push(c.consume());
      }

      const declaration = consumeDeclarationFromComponents(
        new ComponentCursor(temp, { context: c.context }),
      );

      if (declaration !== null) items.push(declaration);

      continue;
    }

    if (isDelimToken(comp, '&')) {
      const rule = consumeQualifiedRuleFromComponents(c);
      if (rule !== null) items.push(rule);

      continue;
    }

    while (!isComponentDeclarationEnd(c.peek())) {
      c.consume();
    }
  }
}

// 5.4.5. Consume a list of declarations
function consumeListOfDeclarationsFromTokens(c: TokenCursor): DeclarationOrAtRuleList {
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
      declarations.push(consumeAtRuleFromTokens(c));
      continue;
    }

    if (token.kind === TokenKind.Ident) {
      const temp: ComponentValue[] = [token];

      while (!isDeclarationEnd(c.peek())) {
        temp.push(consumeComponentValueFromTokens(c));
      }

      const declaration = consumeDeclarationFromComponents(new ComponentCursor(temp));
      if (declaration !== null) declarations.push(declaration);

      continue;
    }

    c.restore(pos);

    while (!isDeclarationEnd(c.peek())) {
      consumeComponentValueFromTokens(c);
    }
  }
}

// 5.4.6. Consume a declaration
function consumeDeclarationFromComponents(c: ComponentCursor): Declaration | null {
  const comp = c.next();

  if (!isIdentToken(comp)) {
    throw new Error('consumeDeclarationFromComponents called without an ident token');
  }

  const declaration: Declaration = {
    name: comp.value,
    value: [],
    important: false,
  };

  while (isWhitespaceToken(c.peek())) {
    c.next();
  }

  if (!isTokenKind(c.peek(), TokenKind.Colon)) {
    return null;
  }

  c.next();

  while (isWhitespaceToken(c.peek())) {
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

  const bang = value[bangIndex]!;
  const important = value[importantIndex]!;

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
    if (!isWhitespaceToken(values[i]!)) {
      return i;
    }
  }

  return -1;
}

function trimTrailingWhitespace(values: ComponentValue[]): void {
  while (values.length > 0 && isWhitespaceToken(values[values.length - 1]!)) {
    values.pop();
  }
}

// 5.4.7. Consume a component value
function consumeComponentValueFromTokens(c: TokenCursor): ComponentValue {
  const token = c.next();

  if (token.kind === TokenKind.LeftBrace) {
    return consumeSimpleBlockFromTokens(c, BlockKind.Brace);
  }

  if (token.kind === TokenKind.LeftBracket) {
    return consumeSimpleBlockFromTokens(c, BlockKind.Bracket);
  }

  if (token.kind === TokenKind.LeftParen) {
    return consumeSimpleBlockFromTokens(c, BlockKind.Parens);
  }

  if (token.kind === TokenKind.Function) {
    return consumeFunctionFromTokens(c, token.value);
  }

  if (!isPreservedToken(token)) {
    throw new Error('consumeComponentValueFromTokens called at EOF or with a non-preserved token');
  }

  return token;
}

// 5.4.8. Consume a simple block
function consumeSimpleBlockFromTokens<K extends SimpleBlockKind>(c: TokenCursor, block: K): SimpleBlock<K> {
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
    result.value.push(consumeComponentValueFromTokens(c));
  }
}

function blockEndingTokenKind(block: BlockKind): TokenKind {
  switch (block) {
    case BlockKind.Brace:
      return TokenKind.RightBrace;

    case BlockKind.Bracket:
      return TokenKind.RightBracket;

    case BlockKind.Parens:
    case BlockKind.Function:
      return TokenKind.RightParen;
  }
}

// 5.4.9. Consume a function
function consumeFunctionFromTokens(c: TokenCursor, name: string): FunctionBlock {
  const result: FunctionBlock = {
    block: BlockKind.Function,
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
    result.value.push(consumeComponentValueFromTokens(c));
  }
}

// ---

export function consumeComponentTrivia(c: ComponentCursor): void {
  while (isWhitespaceToken(c.peek())) {
    c.next();
  }
}

function consumeComponentTriviaAndSemicolons(c: ComponentCursor): void {
  while (true) {
    const comp = c.peek();

    if (
      isWhitespaceToken(comp) ||
      isTokenKind(comp, TokenKind.Semicolon)
    ) {
      c.next();
      continue;
    }

    return;
  }
}

type PreservedTokenKind = PreservedToken['kind'];

export function isTokenKind<K extends PreservedTokenKind>(comp: ComponentValue | null, kind: K): comp is Extract<PreservedToken, { kind: K; }> {
  return comp !== null && 'kind' in comp && comp.kind === kind;
}

export function isIdentToken(comp: ComponentValue | null): comp is IdentToken {
  return isTokenKind(comp, TokenKind.Ident);
}

export function isDelimToken(comp: ComponentValue | null, delim: string): comp is DelimToken {
  return isTokenKind(comp, TokenKind.Delim) && comp.value === delim;
}

export function isWhitespaceToken(comp: ComponentValue | null): comp is StaticToken<TokenKind.Whitespace> {
  return isTokenKind(comp, TokenKind.Whitespace);
}

export function isIdentTokenWithValue(comp: ComponentValue | null, expected: string, isInsensitive = false): comp is IdentToken {
  return isIdentToken(comp)
    && (
      isInsensitive
        ? asciiLower(comp.value) === asciiLower(expected)
        : comp.value === expected
    );
}

export function isComponentBlock(comp: ComponentValue | null): comp is ComponentBlock {
  return comp !== null && !('kind' in comp);
}

export function isBlockKind<K extends BlockKind>(
  comp: ComponentValue | null,
  block: K,
): comp is ComponentBlock & { block: K; } {
  return isComponentBlock(comp) && comp.block === block;
}

export function isBraceBlock(comp: ComponentValue | null): comp is BraceBlock {
  return isBlockKind(comp, BlockKind.Brace);
}

export function isBracketBlock(comp: ComponentValue | null): comp is BracketBlock {
  return isBlockKind(comp, BlockKind.Bracket);
}

export function isParensBlock(comp: ComponentValue | null): comp is ParensBlock {
  return isBlockKind(comp, BlockKind.Parens);
}

export function isFunctionBlock(comp: ComponentValue | null): comp is FunctionBlock {
  return isBlockKind(comp, BlockKind.Function);
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

function isComponentDeclarationEnd(comp: ComponentValue | null): boolean {
  return comp === null || isTokenKind(comp, TokenKind.Semicolon);
}

export function singleIdentToken(components: readonly ComponentValue[]): IdentToken | null {
  let ident: IdentToken | null = null;

  for (const component of components) {
    if (isWhitespaceToken(component)) {
      continue;
    }

    if (!isIdentToken(component)) {
      return null;
    }

    if (ident !== null) {
      return null;
    }

    ident = component;
  }

  return ident;
}
