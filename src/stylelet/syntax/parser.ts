import { asciiLower } from '../../infra/ascii';

import {
  isBraceBlock, isComponentValue, isDelimToken, isIdentToken, isTokenKind,
  isWhitespaceToken,
  type ComponentValue, type FunctionBlock, type SimpleBlock,
} from './component-value';
import { TokenCursor, type TryConsumer, type TryConsumerResult } from './token-cursor';
import { tokenize, tokenizeWithSource, TokenKind, type Token } from './tokens';

/** A generic CSS rule, before selector and property grammar interpretation. */
// CSS Syntax parsing results: https://drafts.csswg.org/css-syntax-3/#css-tree
export type Rule =
  | AtRule
  | QualifiedRule;

export type AtRule =
  | StatementAtRule
  | BlockAtRule;

export type StatementAtRule = {
  type: 'statement-at-rule';
  name: string;
  prelude: ComponentValue[];
};

export type BlockAtRule = {
  type: 'block-at-rule';
  name: string;
  prelude: ComponentValue[];
  block: BlockContents;
};

export type QualifiedRule = {
  type: 'qualified-rule';
  prelude: ComponentValue[];
  block: BlockContents;
};

export type Declaration = {
  name: string;
  value: ComponentValue[];
  important: boolean;
  originalText?: string;
};

export type BlockContents = Array<DeclarationList | Rule>;
export type DeclarationList = Declaration[];
export type QualifiedRuleList = QualifiedRule[];
export type AtRuleList = AtRule[];
export type DeclarationRuleList = Array<DeclarationList | AtRule>;
export type RuleList = Array<QualifiedRule | AtRule>;

/** CSS text or an existing token sequence; byte decoding is a separate step. */
export type ParserInput = string | Token[];

export function createComponentParser<T>(
  consumer: TryConsumer<T>,
): (
  input: ParserInput,
  context?: unknown,
) => TryConsumerResult<T> {
  return (input, context = undefined) =>
    parseAsComponentGrammar(input, consumer, context);
}

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-grammar
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

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-comma-list
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

/** Parse stylesheet contents into generic rules, leaving sheet creation to CSSOM. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-stylesheet-contents
export function parseStylesheetContents(input: ParserInput): Rule[] {
  return consumeStylesheetContents(normalize(input));
}

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-block-contents
export function parseBlockContents(
  input: ParserInput,
  context: unknown = undefined,
): BlockContents {
  return consumeBlockContents(normalize(input, context));
}

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-rule
export function parseRule(input: ParserInput): Rule | null {
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

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-declaration
export function parseDeclaration(
  input: ParserInput,
  context: unknown = undefined,
): Declaration | null {
  const c = normalize(input, context);
  consumeTrivia(c);
  return consumeDeclaration(c);
}

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-component-value
export function parseComponentValue(input: ParserInput): ComponentValue | null {
  const c = normalize(input);

  consumeTrivia(c);
  if (c.eof()) return null;

  const value = consumeComponentValue(c);

  consumeTrivia(c);
  return c.eof() ? value : null;
}

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-list-of-component-values
export function parseListOfComponentValues(input: ParserInput): ComponentValue[] {
  if (typeof input !== 'string' && input.every(isComponentValue)) {
    return input;
  }

  return consumeListOfComponentValues(normalize(input));
}

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-comma-separated-list-of-component-values
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

/**
 * Parse declaration-only input into syntax records, without validating property names or values.
 * Recover through semicolons without admitting nested style rules.
 */
// CSS Style Attributes: https://drafts.csswg.org/css-style-attr/#syntax
// This entry point implements that grammar using the shared CSS Syntax consumers.
// SPEC_CLASH(css-style-attribute-parsing): Follow CSS Style Attributes and all
// three engines. CSSOM's newer block-contents reference also admits nested rules
// and treats an unmatched closing brace as the end of the whole input.
export function parseDeclarationList(input: ParserInput): Declaration[] {
  const c = normalize(input);
  const declarations: Declaration[] = [];
  while (!c.eof()) {
    const type = c.peek().type;
    if (type === TokenKind.Whitespace || type === TokenKind.Semicolon) {
      c.next();
    } else if (type === TokenKind.AtKeyword) {
      consumeAtRule(c);
    } else {
      const declaration = consumeDeclaration(c);
      if (declaration !== null) declarations.push(declaration);
    }
  }
  return declarations;
}

/** Tokenize text with source locations, or wrap supplied tokens in a cursor. */
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
// and defers property-, descriptor-, and rule-specific validity to later
// interpretation. The specification's implementation note suggests that
// grammar-aware checks mainly enable earlier exits and avoid reparsing. Revisit
// this when those contexts exist, and verify that deferred validation still
// preserves invalid-rule recovery and declaration-list boundaries.

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-stylesheet-contents
function consumeStylesheetContents(c: TokenCursor<Token>): Rule[] {
  const rules: Rule[] = [];

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

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-at-rule
function consumeAtRule<Value extends Token>(
  c: TokenCursor<Value>,
  nested = false,
): AtRule {
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

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-qualified-rule
function consumeQualifiedRule<Value extends Token>(
  c: TokenCursor<Value>,
  stopToken?: TokenKind,
  nested = false,
): QualifiedRule | null {
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

function looksLikeCustomProperty(prelude: ComponentValue[]): boolean {
  const values = prelude.filter((value) => !isWhitespaceToken(value));

  return values.length >= 2 &&
    isIdentToken(values[0]!) &&
    values[0].value.startsWith('--') &&
    isTokenKind(values[1]!, TokenKind.Colon);
}

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-block
function consumeBlock<Value extends Token>(c: TokenCursor<Value>): BlockContents {
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

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-block-contents
function consumeBlockContents<Value extends Token>(c: TokenCursor<Value>): BlockContents {
  const contents: BlockContents = [];
  let declarations: Declaration[] = [];

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

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-declaration
export function consumeDeclaration<Value extends Token>(
  c: TokenCursor<Value>,
  nested = false,
): Declaration | null {
  const token = c.peek();

  if (!isIdentToken(token)) {
    consumeBadDeclarationRemnants(c, nested);
    return null;
  }

  c.next();

  const declaration: Declaration = {
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

function consumeImportantFlag(declaration: Declaration): number {
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
  values: ComponentValue[],
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

function hasDisallowedTopLevelBraceBlock(values: ComponentValue[]): boolean {
  const significant = values.filter((value) => !isWhitespaceToken(value));
  const braces = significant.filter(isBraceBlock);

  return braces.length > 0 && (significant.length !== 1 || braces.length !== 1);
}

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-list-of-components
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

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-component-value
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

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-simple-block
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

// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-function
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
