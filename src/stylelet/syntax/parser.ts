import { asciiLower } from '../../shared/css';
import {
  isBraceBlock, isComponentValue, isDelimToken, isIdentToken, isTokenKind,
  isWhitespaceToken,
  type ComponentValue, type FunctionBlock, type SimpleBlock,
} from './component-value';
import { TokenCursor, type TryConsumer, type TryConsumerResult } from './token-cursor';
import { tokenize, tokenizeWithSource, TokenKind, type Token } from './tokens';

export type SyntaxStyleSheet = {
  rules: SyntaxRule[];
  location?: URL;
  originalText?: string;
};

export type SyntaxRule =
  | SyntaxAtRule
  | SyntaxQualifiedRule;

export type SyntaxAtRule =
  | SyntaxStatementAtRule
  | SyntaxBlockAtRule;

export type SyntaxStatementAtRule = {
  type: 'statement-at-rule';
  name: string;
  prelude: ComponentValue[];
};

export type SyntaxBlockAtRule = {
  type: 'block-at-rule';
  name: string;
  prelude: ComponentValue[];
  block: SyntaxBlockContents;
};

export type SyntaxQualifiedRule = {
  type: 'qualified-rule';
  prelude: ComponentValue[];
  block: SyntaxBlockContents;
};

export type SyntaxDeclaration = {
  name: string;
  value: ComponentValue[];
  important: boolean;
  originalText?: string;
};

export type SyntaxBlockContents = Array<SyntaxDeclarationList | SyntaxRule>;
export type SyntaxDeclarationList = SyntaxDeclaration[];
export type SyntaxQualifiedRuleList = SyntaxQualifiedRule[];
export type SyntaxAtRuleList = SyntaxAtRule[];
export type SyntaxDeclarationRuleList = Array<SyntaxDeclarationList | SyntaxAtRule>;
export type SyntaxRuleList = Array<SyntaxQualifiedRule | SyntaxAtRule>;

export type ParserInput = string | readonly Token[];

export function createComponentParser<T>(
  consumer: TryConsumer<T>,
): (
  input: ParserInput,
  context?: unknown,
) => TryConsumerResult<T> {
  return (input, context = undefined) =>
    parseAsComponentGrammar(input, consumer, context);
}

// 5.4.1. Parse something according to a CSS grammar
export function parseAsComponentGrammar<T>(
  input: ParserInput,
  consumer: TryConsumer<T>,
  context: unknown = undefined,
): TryConsumerResult<T> {
  const components = parseListOfComponentValues(input);
  const c = new TokenCursor(components, { context });
  const result = consumer(c);

  if (result === null) return null;

  c.consumeWhile(isWhitespaceToken);
  return c.eof() ? result : null;
}

// 5.4.2. Parse a comma-separated list according to a CSS grammar
export function parseListAsComponentGrammar<T>(
  input: ParserInput,
  consumer: TryConsumer<T>,
  context: unknown = undefined,
): (TryConsumerResult<T>)[] {
  const lists = parseCommaSeparatedListOfComponentValues(input);

  if (
    lists.length === 1 &&
    lists[0]!.length > 0 &&
    lists[0]!.every(isWhitespaceToken)
  ) {
    return [];
  }

  return lists.map((item) => parseAsComponentGrammar(item, consumer, context));
}

// 5.4.3. Parse a stylesheet
export function parseSyntaxStylesheet(
  input: ParserInput,
  location?: URL,
): SyntaxStyleSheet {
  return {
    rules: consumeStylesheetContents(normalize(input)),
    ...(location === undefined ? {} : { location }),
    ...(typeof input === 'string' ? { originalText: input } : {}),
  };
}

// 5.4.4. Parse a stylesheet's contents
export function parseSyntaxStylesheetContents(input: ParserInput): SyntaxRule[] {
  return consumeStylesheetContents(normalize(input));
}

// Legacy name retained for callers using the former specification terminology.
export const parseListOfRules = parseSyntaxStylesheetContents;

// 5.4.5. Parse a block's contents
export function parseBlockContents(
  input: ParserInput,
  context: unknown = undefined,
): SyntaxBlockContents {
  return consumeBlockContents(normalize(input, context));
}

// 5.4.6. Parse a rule
export function parseRule(input: ParserInput): SyntaxRule | null {
  const c = normalize(input);

  consumeTrivia(c);
  if (c.eof()) return null;

  const rule = c.peek().type === TokenKind.AtKeyword
    ? consumeAtRule(c)
    : consumeQualifiedRule(c);

  if (rule === null) return null;

  consumeTrivia(c);
  return c.eof() ? rule : null;
}

// 5.4.7. Parse a declaration
export function parseDeclaration(
  input: ParserInput,
  context: unknown = undefined,
): SyntaxDeclaration | null {
  const c = normalize(input, context);
  consumeTrivia(c);
  return consumeDeclaration(c);
}

// 5.4.8. Parse a component value
export function parseComponentValue(input: ParserInput): ComponentValue | null {
  const c = normalize(input);

  consumeTrivia(c);
  if (c.eof()) return null;

  const value = consumeComponentValue(c);

  consumeTrivia(c);
  return c.eof() ? value : null;
}

// 5.4.9. Parse a list of component values
export function parseListOfComponentValues(input: ParserInput): readonly ComponentValue[] {
  if (typeof input !== 'string' && input.every(isComponentValue)) {
    return input;
  }

  return consumeListOfComponentValues(normalize(input));
}

// 5.4.10. Parse a comma-separated list of component values
export function parseCommaSeparatedListOfComponentValues(
  input: ParserInput,
): ComponentValue[][] {
  const c = normalize(input);
  const groups: ComponentValue[][] = [];

  while (!c.eof()) {
    groups.push(consumeListOfComponentValues(c, TokenKind.Comma));
    c.next();
  }

  return groups;
}

function normalize(input: ParserInput, context: unknown = undefined): TokenCursor<Token> {
  if (typeof input !== 'string') return new TokenCursor(input, { context });

  const { source, tokens, ranges } = tokenizeWithSource(input);
  return new TokenCursor(tokens, {
    context,
    source: { text: source, ranges },
  });
}

function consumeTrivia<Value extends Token>(c: TokenCursor<Value>): void {
  c.consumeWhile(isWhitespaceToken);
}

// TODO: Sections 5.5.2, 5.5.3, 5.5.6, and 7 describe validating rules and
// declarations in their current context while consuming them. This parser
// currently performs only the structural checks needed for generic CSS syntax
// and defers property-, descriptor-, and rule-specific validity to semantic
// interpretation. The specification's implementation note suggests that
// grammar-aware checks mainly enable earlier exits and avoid reparsing. Revisit
// this when those contexts exist, and verify that deferred validation still
// preserves invalid-rule recovery and declaration-list boundaries.

// 5.5.1. Consume a stylesheet's contents
function consumeStylesheetContents(c: TokenCursor<Token>): SyntaxRule[] {
  const rules: SyntaxRule[] = [];

  while (true) {
    switch (c.peek().type) {
      case TokenKind.Whitespace:
      case TokenKind.CDO:
      case TokenKind.CDC:
        c.next();
        break;

      case TokenKind.EOF:
        return rules;

      case TokenKind.AtKeyword:
        rules.push(consumeAtRule(c));
        break;

      default: {
        const rule = consumeQualifiedRule(c);
        if (rule !== null) rules.push(rule);
      }
    }
  }
}

// 5.5.2. Consume an at-rule
function consumeAtRule<Value extends Token>(
  c: TokenCursor<Value>,
  nested = false,
): SyntaxAtRule {
  const token = c.next();

  if (token.type !== TokenKind.AtKeyword) {
    c.error('Expected an at-keyword token');
  }

  const name = token.value;
  const prelude: ComponentValue[] = [];

  while (true) {
    switch (c.peek().type) {
      case TokenKind.Semicolon:
      case TokenKind.EOF:
        c.next();
        return { type: 'statement-at-rule', name, prelude };

      case TokenKind.RightBrace:
        if (nested) {
          return { type: 'statement-at-rule', name, prelude };
        }
        prelude.push(consumeComponentValue(c));
        break;

      case TokenKind.LeftBrace:
      case TokenKind.BraceBlock:
        return {
          type: 'block-at-rule',
          name,
          prelude,
          block: consumeBlock(c),
        };

      default:
        prelude.push(consumeComponentValue(c));
    }
  }
}

// 5.5.3. Consume a qualified rule
function consumeQualifiedRule<Value extends Token>(
  c: TokenCursor<Value>,
  stopToken?: TokenKind,
  nested = false,
): SyntaxQualifiedRule | null {
  const prelude: ComponentValue[] = [];

  while (true) {
    const token = c.peek();

    if (token.type === TokenKind.EOF || token.type === stopToken) {
      return null;
    }

    if (token.type === TokenKind.RightBrace) {
      if (nested) return null;

      prelude.push(consumeComponentValue(c));
      continue;
    }

    if (
      token.type === TokenKind.LeftBrace ||
      token.type === TokenKind.BraceBlock
    ) {
      if (looksLikeCustomProperty(prelude)) {
        if (nested) {
          consumeBadDeclarationRemnants(c, true);
        } else {
          consumeBlock(c);
        }
        return null;
      }

      return {
        type: 'qualified-rule',
        prelude,
        block: consumeBlock(c),
      };
    }

    prelude.push(consumeComponentValue(c));
  }
}

function looksLikeCustomProperty(prelude: readonly ComponentValue[]): boolean {
  const values = prelude.filter((value) => !isWhitespaceToken(value));

  return values.length >= 2 &&
    isIdentToken(values[0]!) &&
    values[0].value.startsWith('--') &&
    isTokenKind(values[1]!, TokenKind.Colon);
}

// 5.5.4. Consume a block
function consumeBlock<Value extends Token>(c: TokenCursor<Value>): SyntaxBlockContents {
  const opening = c.peek();

  if (isBraceBlock(opening)) {
    c.next();
    return consumeBlockContents(new TokenCursor(opening.value, { context: c.context }));
  }

  if (opening.type !== TokenKind.LeftBrace) {
    c.error('Expected an opening brace token');
  }

  c.next();
  const contents = consumeBlockContents(c);
  c.next();
  return contents;
}

// 5.5.5. Consume a block's contents
function consumeBlockContents<Value extends Token>(c: TokenCursor<Value>): SyntaxBlockContents {
  const contents: SyntaxBlockContents = [];
  let declarations: SyntaxDeclaration[] = [];

  const flushDeclarations = (): void => {
    if (declarations.length === 0) return;

    contents.push(declarations);
    declarations = [];
  };

  while (true) {
    switch (c.peek().type) {
      case TokenKind.Whitespace:
      case TokenKind.Semicolon:
        c.next();
        break;

      case TokenKind.EOF:
      case TokenKind.RightBrace:
        // The editor's draft currently omits this flush, which would discard
        // every trailing declaration run. The surrounding algorithm requires it.
        flushDeclarations();
        return contents;

      case TokenKind.AtKeyword:
        flushDeclarations();
        contents.push(consumeAtRule(c, true));
        break;

      default: {
        const start = c.pos();
        const declaration = consumeDeclaration(c, true);

        if (declaration !== null) {
          declarations.push(declaration);
          break;
        }

        c.restore(start);
        const rule = consumeQualifiedRule(c, TokenKind.Semicolon, true);

        if (rule !== null) {
          flushDeclarations();
          contents.push(rule);
        }
      }
    }
  }
}

// 5.5.6. Consume a declaration
export function consumeDeclaration<Value extends Token>(
  c: TokenCursor<Value>,
  nested = false,
): SyntaxDeclaration | null {
  const token = c.peek();

  if (!isIdentToken(token)) {
    consumeBadDeclarationRemnants(c, nested);
    return null;
  }

  c.next();

  const declaration: SyntaxDeclaration = {
    name: token.value,
    value: [],
    important: false,
  };

  consumeTrivia(c);

  if (c.peek().type !== TokenKind.Colon) {
    consumeBadDeclarationRemnants(c, nested);
    return null;
  }

  c.next();
  consumeTrivia(c);
  const valueStart = c.pos();
  declaration.value = consumeListOfComponentValues(c, TokenKind.Semicolon, nested);
  let valueEnd = c.pos();

  valueEnd -= consumeImportantFlag(declaration);
  valueEnd -= trimTrailingWhitespace(declaration.value);
  const originalText = c.sourceText(valueStart, valueEnd);

  if (declaration.name.startsWith('--')) {
    declaration.originalText = originalText;
    return declaration;
  }

  if (hasDisallowedTopLevelBraceBlock(declaration.value)) {
    return null;
  }

  if (
    asciiLower(declaration.name) === 'unicode-range' &&
    originalText !== undefined
  ) {
    declaration.value = [...parseListOfComponentValues(
      tokenize(originalText, true),
    )];
  }

  return declaration;
}

function consumeBadDeclarationRemnants<Value extends Token>(
  c: TokenCursor<Value>,
  nested: boolean,
): void {
  while (true) {
    switch (c.peek().type) {
      case TokenKind.EOF:
      case TokenKind.Semicolon:
        c.next();
        return;

      case TokenKind.RightBrace:
        if (nested) return;
        c.next();
        break;

      default:
        consumeComponentValue(c);
    }
  }
}

function consumeImportantFlag(declaration: SyntaxDeclaration): number {
  const value = declaration.value;
  const importantIndex = lastNonWhitespaceIndex(value, value.length - 1);
  if (importantIndex < 0) return 0;

  const bangIndex = lastNonWhitespaceIndex(value, importantIndex - 1);
  if (bangIndex < 0) return 0;

  const bang = value[bangIndex]!;
  const important = value[importantIndex]!;

  if (
    isDelimToken(bang, '!') &&
    isIdentToken(important) &&
    asciiLower(important.value) === 'important'
  ) {
    const removed = value.length - bangIndex;
    value.splice(bangIndex);
    declaration.important = true;
    return removed;
  }

  return 0;
}

function lastNonWhitespaceIndex(
  values: readonly ComponentValue[],
  start: number,
): number {
  for (let i = start; i >= 0; i--) {
    if (!isWhitespaceToken(values[i]!)) return i;
  }

  return -1;
}

function trimTrailingWhitespace(values: ComponentValue[]): number {
  const start = values.length;

  while (values.length > 0 && isWhitespaceToken(values[values.length - 1]!)) {
    values.pop();
  }

  return start - values.length;
}

function hasDisallowedTopLevelBraceBlock(values: readonly ComponentValue[]): boolean {
  const significant = values.filter((value) => !isWhitespaceToken(value));
  const braces = significant.filter(isBraceBlock);

  return braces.length > 0 && (significant.length !== 1 || braces.length !== 1);
}

// 5.5.7. Consume a list of component values
function consumeListOfComponentValues<Value extends Token>(
  c: TokenCursor<Value>,
  stopToken?: TokenKind,
  nested = false,
): ComponentValue[] {
  const values: ComponentValue[] = [];

  while (true) {
    const token = c.peek();

    if (token.type === TokenKind.EOF || token.type === stopToken) {
      return values;
    }

    if (token.type === TokenKind.RightBrace && nested) {
      return values;
    }

    values.push(consumeComponentValue(c));
  }
}

// 5.5.8. Consume a component value
// The parser uses one cursor abstraction for both lexical token streams and
// component-value streams. Consuming a component value folds opening and
// function tokens into blocks; grammar consumers then reuse the same cursor
// over the resulting component values.
function consumeComponentValue<Value extends Token>(
  c: TokenCursor<Value>,
): ComponentValue {
  switch (c.peek().type) {
    case TokenKind.LeftBrace:
    case TokenKind.LeftBracket:
    case TokenKind.LeftParen:
      return consumeSimpleBlock(c);

    case TokenKind.Function:
      return consumeFunction(c);

    case TokenKind.EOF:
      return c.error('Unexpected end of token stream');

    default:
      return c.next() as ComponentValue;
  }
}

// 5.5.9. Consume a simple block
function consumeSimpleBlock<Value extends Token>(
  c: TokenCursor<Value>,
): SimpleBlock {
  const opening = c.peek();
  let block: SimpleBlock;
  let ending: TokenKind;

  switch (opening.type) {
    case TokenKind.LeftBrace:
      block = { type: TokenKind.BraceBlock, value: [] };
      ending = TokenKind.RightBrace;
      break;

    case TokenKind.LeftBracket:
      block = { type: TokenKind.BracketBlock, value: [] };
      ending = TokenKind.RightBracket;
      break;

    case TokenKind.LeftParen:
      block = { type: TokenKind.ParensBlock, value: [] };
      ending = TokenKind.RightParen;
      break;

    default:
      c.error('Expected an opening block token');
  }

  c.next();

  while (true) {
    const token = c.peek();

    if (token.type === TokenKind.EOF || token.type === ending) {
      c.next();
      return block;
    }

    block.value.push(consumeComponentValue(c));
  }
}

// 5.5.10. Consume a function
function consumeFunction<Value extends Token>(
  c: TokenCursor<Value>,
): FunctionBlock {
  const token = c.next();

  if (token.type !== TokenKind.Function) {
    c.error('Expected a function token');
  }

  const fn: FunctionBlock = {
    type: TokenKind.FunctionBlock,
    name: token.value,
    value: [],
  };

  while (true) {
    const next = c.peek();

    if (next.type === TokenKind.EOF || next.type === TokenKind.RightParen) {
      c.next();
      return fn;
    }

    fn.value.push(consumeComponentValue(c));
  }
}
