import { asciiLower } from '../../infra/ascii';

import {
  isBraceBlock, isComponentValue, isDelimToken, isIdentToken, isTokenKind,
  isWhitespaceToken,
  type ComponentValue, type FunctionBlock, type SimpleBlock,
} from './component-value';
import { emptyParsingContext, TokenCursor, type TryConsumer, type TryConsumerResult } from './token-cursor';
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
  /** Value spelling when the input retains source text; absent for bare token lists. */
  originalText?: string;
};

/** Preserve source order until the owning rule interprets declaration runs and child rules. */
export type BlockContents<ParsedRule extends object = Rule, ParsedDeclaration = Declaration> =
  Array<ParsedDeclaration[] | ParsedRule>;
export type DeclarationList = Declaration[];
export type QualifiedRuleList = QualifiedRule[];
export type AtRuleList = AtRule[];
export type DeclarationRuleList = Array<DeclarationList | AtRule>;
export type RuleList = Array<QualifiedRule | AtRule>;

/** CSS text, tokens/components, or a stream at its current position; decode bytes first. */
export type ParserInput = string | Token[] | TokenCursor<Token>;

/** Grammar decisions made while consuming one rule list, supplied by its owning context. */
// CSS Syntax deliberately leaves context passing to implementations:
// https://drafts.csswg.org/css-syntax-3/#parser-algorithms
export interface ParsingContext<ParsedRule extends object = object, ParsedDeclaration = unknown> {
  /** Reject invalid declarations before the parser decides whether to retry as a rule. */
  interpretDeclaration(declaration: Declaration): ParsedDeclaration | null;
  /** Check statement grammar and placement against already consumed siblings. */
  interpretStatementAtRule(
    rule: StatementAtRule,
    preceding: BlockContents<ParsedRule, ParsedDeclaration>,
  ): ParsedRule | null;
  /** Interpret the whole rule, consuming or discarding the block at the cursor. */
  interpretBlockAtRule(
    name: string,
    prelude: ComponentValue[],
    preceding: BlockContents<ParsedRule, ParsedDeclaration>,
    c: TokenCursor<Token>,
  ): ParsedRule | null;
  /** Interpret the prelude and block; consume the block even when returning null. */
  interpretQualifiedRule(prelude: ComponentValue[], c: TokenCursor<Token>): ParsedRule | null;
}

/** Bind a component grammar to a parser entry point. */
export function createComponentParser<T>(
  consumer: TryConsumer<T>,
): (
  input: ParserInput,
  context?: unknown,
) => TryConsumerResult<T> {
  return (input, context = emptyParsingContext) =>
    parseAsComponentGrammar(input, consumer, context);
}

/** Match the entire remaining input against a grammar, returning null on failure. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-grammar
export function parseAsComponentGrammar<T>(
  input: ParserInput,
  consumer: TryConsumer<T>,
  context: unknown = emptyParsingContext,
): TryConsumerResult<T> {
  const components = parseListOfComponentValues(input);
  const c = new TokenCursor(components, input instanceof TokenCursor ? input.context : context);
  const result = consumer(c);

  if (result === null) return null;

  c.consumeWhile(isWhitespaceToken);
  return c.eof() ? result : null;
}

/** Match comma-separated items independently; a failed item contributes null. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-comma-list
export function parseListAsComponentGrammar<T>(
  input: ParserInput,
  consumer: TryConsumer<T>,
  context: unknown = emptyParsingContext,
): (TryConsumerResult<T>)[] {
  const lists = parseCommaSeparatedListOfComponentValues(input);
  const grammarContext = input instanceof TokenCursor ? input.context : context;

  if (
    lists.length === 1 &&
    lists[0]!.length > 0 &&
    lists[0]!.every(isWhitespaceToken)
  ) {
    return [];
  }

  return lists.map((item) => parseAsComponentGrammar(item, consumer, grammarContext));
}

/** Parse stylesheet contents using the owning grammar's interpretation of each rule. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-stylesheet-contents
export function parseStylesheetContents<ParsedRule extends object, ParsedDeclaration>(
  input: ParserInput,
  context: ParsingContext<ParsedRule, ParsedDeclaration>,
): ParsedRule[] {
  return consumeInput(input, context, consumeStylesheetContents);
}

/** Parse mixed declaration/rule content, stopping before an unmatched closing brace. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-block-contents
export function parseBlockContents<ParsedRule extends object, ParsedDeclaration>(
  input: ParserInput,
  context: ParsingContext<ParsedRule, ParsedDeclaration>,
): BlockContents<ParsedRule, ParsedDeclaration> {
  return consumeInput(input, context, consumeBlockContents);
}

/** Parse exactly one rule in its grammar context; return null on invalid or extra input. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-rule
export function parseRule<ParsedRule extends object, ParsedDeclaration>(
  input: ParserInput,
  context: ParsingContext<ParsedRule, ParsedDeclaration>,
): ParsedRule | null {
  return consumeInput(input, context, consumeSingleRule);
}

/** Read declaration syntax in the caller's context, without interpreting its property or descriptor. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-declaration
export function parseDeclaration<Context>(input: ParserInput, context: Context): Declaration | null {
  return consumeInput(input, context, consumeSingleDeclaration);
}

/** Parse exactly one component value, allowing surrounding whitespace; return null otherwise. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-component-value
export function parseComponentValue(input: ParserInput): ComponentValue | null {
  const c = getTokenCursor(input);

  consumeTrivia(c);
  if (c.eof()) return null;

  const value = consumeComponentValue(c);

  consumeTrivia(c);
  return c.eof() ? value : null;
}

/** Consume all remaining components, reusing blocks that have already been parsed. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-list-of-component-values
export function parseListOfComponentValues(input: ParserInput): ComponentValue[] {
  if (Array.isArray(input) && input.every(isComponentValue)) {
    return input;
  }

  const c = getTokenCursor(input);
  return consumeListOfComponentValues(c);
}

/** Split on top-level commas, retaining empty arms except for an empty trailing arm. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#parse-comma-separated-list-of-component-values
export function parseCommaSeparatedListOfComponentValues(
  input: ParserInput,
): ComponentValue[][] {
  const c = getTokenCursor(input);
  const groups: ComponentValue[][] = [];

  while (!c.eof()) {
    groups.push(consumeListOfComponentValues(c, TokenKind.Comma));
    c.next();
  }

  return groups;
}

/**
 * Parse declaration-only input into syntax records, without validating property names or values.
 * Preserve the caller's context and recover through semicolons without admitting nested style rules.
 */
// CSS Style Attributes: https://drafts.csswg.org/css-style-attr/#syntax
// This entry point implements that grammar using the shared CSS Syntax consumers.
// SPEC_CLASH(css-style-attribute-parsing): Follow CSS Style Attributes and all
// three engines. CSSOM's newer block-contents reference also admits nested rules
// and treats an unmatched closing brace as the end of the whole input.
export function parseDeclarationList<Context>(input: ParserInput, context: Context): Declaration[] {
  return consumeInput(input, context, consumeDeclarationList);
}

/** Skip an invalid rule's balanced block without interpreting its children. */
export function discardRuleBlock<Value extends Token>(c: TokenCursor<Value>): void {
  consumeComponentValue(c);
}

/** Consume a brace-delimited block, including its closing brace when present. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-block
export function consumeBlock<Value extends Token, ParsedRule extends object, ParsedDeclaration>(
  c: TokenCursor<Value, ParsingContext<ParsedRule, ParsedDeclaration>>,
): BlockContents<ParsedRule, ParsedDeclaration> {
  const opening = c.peek();

  if (isBraceBlock(opening)) {
    c.next();
    // TODO: Prebuilt component blocks do not retain source ranges for their children.
    return consumeBlockContents(new TokenCursor(opening.value, c.context));
  }

  if (opening.type !== TokenKind.LeftBrace) {
    c.error('Expected an opening brace token');
  }

  c.next();
  const contents = consumeBlockContents(c);
  c.next();
  return contents;
}

/** Consume the declaration-only attribute grammar, ignoring complete at-rules. */
// https://drafts.csswg.org/css-style-attr/#syntax
function consumeDeclarationList(c: TokenCursor<Token>): Declaration[] {
  const declarations: Declaration[] = [];
  while (!c.eof()) {
    const type = c.peek().type;
    if (type === TokenKind.Whitespace || type === TokenKind.Semicolon) {
      c.next();
    } else if (type === TokenKind.AtKeyword) {
      discardAtRule(c);
    } else {
      const declaration = consumeDeclaration(c);
      if (declaration !== null) declarations.push(declaration);
    }
  }
  return declarations;
}

/** Skip a complete at-rule in declaration-only input without invoking rule interpretation. */
// CSS Style Attributes: https://drafts.csswg.org/css-style-attr/#syntax
// Consume the same boundary as https://drafts.csswg.org/css-syntax-3/#consume-at-rule.
function discardAtRule(c: TokenCursor<Token>): void {
  c.next();
  while (true) {
    switch (c.peek().type) {
      case TokenKind.EOF:
        return;
      case TokenKind.Semicolon:
        c.next();
        return;
      case TokenKind.LeftBrace:
      case TokenKind.BraceBlock:
        discardRuleBlock(c);
        return;
      default:
        consumeComponentValue(c);
    }
  }
}

/** Reuse an existing cursor unchanged, or create one for context-free component parsing. */
function getTokenCursor(input: ParserInput): TokenCursor<Token> {
  return input instanceof TokenCursor ? input : normalize(input, emptyParsingContext);
}

/** Consume with the selected context, restoring it only when the cursor belongs to the caller. */
function consumeInput<Context, Result>(
  input: ParserInput,
  context: Context,
  consume: (c: TokenCursor<Token, Context>) => Result,
): Result {
  if (input instanceof TokenCursor) return input.withContext(context, consume);
  return consume(normalize(input, context));
}

/** Create a cursor with its parsing context, retaining source locations when tokenizing text. */
// https://drafts.csswg.org/css-syntax-3/#normalize-into-a-token-stream
function normalize<Context>(input: string | Token[], context: Context): TokenCursor<Token, Context> {
  if (typeof input !== 'string') return new TokenCursor(input, context);

  const { source, tokens, ranges } = tokenizeWithSource(input);
  return new TokenCursor(tokens, context, {
    source: { text: source, ranges },
  });
}

/** Discard whitespace tokens; comments were already consumed by tokenization. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#token-stream-discard-whitespace
function consumeTrivia<Value extends Token>(c: TokenCursor<Value>): void {
  c.consumeWhile(isWhitespaceToken);
}

/** Consume whole-sheet rules, ignoring top-level CDO/CDC tokens and malformed rules. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-stylesheet-contents
function consumeStylesheetContents<ParsedRule extends object, ParsedDeclaration>(
  c: TokenCursor<Token, ParsingContext<ParsedRule, ParsedDeclaration>>,
): ParsedRule[] {
  const rules: ParsedRule[] = [];

  while (true) {
    switch (c.peek().type) {
      case TokenKind.Whitespace:
      case TokenKind.CDO:
      case TokenKind.CDC:
        c.next();
        break;

      case TokenKind.EOF:
        return rules;

      case TokenKind.AtKeyword: {
        const rule = consumeAtRule(c, false, rules);
        if (rule !== null) rules.push(rule);
        break;
      }

      default: {
        const rule = consumeQualifiedRule(c);
        if (rule !== null) rules.push(rule);
      }
    }
  }
}

/** Apply the single-rule entry algorithm using the supplied grammar context. */
// Extracted from https://drafts.csswg.org/css-syntax-3/#parse-rule
function consumeSingleRule<ParsedRule extends object, ParsedDeclaration>(
  c: TokenCursor<Token, ParsingContext<ParsedRule, ParsedDeclaration>>,
): ParsedRule | null {
  consumeTrivia(c);
  if (c.eof()) return null;

  const rule = c.peek().type === TokenKind.AtKeyword
    ? consumeAtRule(c, false, [])
    : consumeQualifiedRule(c);

  if (rule === null) return null;

  consumeTrivia(c);
  return c.eof() ? rule : null;
}

/** Consume and validate an at-rule; nested input leaves the containing closing brace unread. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-at-rule
function consumeAtRule<Value extends Token, ParsedRule extends object, ParsedDeclaration>(
  c: TokenCursor<Value, ParsingContext<ParsedRule, ParsedDeclaration>>,
  nested: boolean,
  preceding: BlockContents<ParsedRule, ParsedDeclaration>,
): ParsedRule | null {
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
        return c.context.interpretStatementAtRule({ type: 'statement-at-rule', name, prelude }, preceding);

      case TokenKind.RightBrace:
        if (nested) {
          return c.context.interpretStatementAtRule({ type: 'statement-at-rule', name, prelude }, preceding);
        }
        prelude.push(consumeComponentValue(c));
        break;

      case TokenKind.LeftBrace:
      case TokenKind.BraceBlock:
        return c.context.interpretBlockAtRule(name, prelude, preceding, c);

      default:
        prelude.push(consumeComponentValue(c));
    }
  }
}

/** Consume a qualified rule, returning null for an incomplete or declaration-shaped construct. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-qualified-rule
// SPEC_CLASH(css-invalid-rule-declaration-runs): A rejected rule returns null,
// just like an incomplete rule, so discarded rules do not split declaration runs.
function consumeQualifiedRule<Value extends Token, ParsedRule extends object, ParsedDeclaration>(
  c: TokenCursor<Value, ParsingContext<ParsedRule, ParsedDeclaration>>,
  stopToken?: TokenKind,
  nested = false,
): ParsedRule | null {
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
          discardRuleBlock(c);
        }
        return null;
      }

      return c.context.interpretQualifiedRule(prelude, c);
    }

    prelude.push(consumeComponentValue(c));
  }
}

/** Identify the custom-property prefix excluded from qualified-rule syntax. */
// Extracted from https://drafts.csswg.org/css-syntax-3/#consume-qualified-rule
function looksLikeCustomProperty(prelude: ComponentValue[]): boolean {
  const values = prelude.filter((value) => !isWhitespaceToken(value));

  return values.length >= 2 &&
    isIdentToken(values[0]!) &&
    values[0].value.startsWith('--') &&
    isTokenKind(values[1]!, TokenKind.Colon);
}

/** Consume ordered declaration runs and rules, leaving a containing closing brace unread. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-block-contents
function consumeBlockContents<Value extends Token, ParsedRule extends object, ParsedDeclaration>(
  c: TokenCursor<Value, ParsingContext<ParsedRule, ParsedDeclaration>>,
): BlockContents<ParsedRule, ParsedDeclaration> {
  const contents: BlockContents<ParsedRule, ParsedDeclaration> = [];
  let declarations: ParsedDeclaration[] = [];

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
        // SPEC_CLASH(css-block-final-declarations): Retain the final run, as all
        // browsers do. The draft's return step omits it and would lose even a
        // declaration-only block; the rest of the algorithm requires this flush.
        flushDeclarations();
        return contents;

      case TokenKind.AtKeyword: {
        flushDeclarations();
        const rule = consumeAtRule(c, true, contents);
        if (rule !== null) contents.push(rule);
        break;
      }

      default: {
        const start = c.pos();
        const syntax = consumeDeclaration(c, true);
        const declaration = syntax === null ? null : c.context.interpretDeclaration(syntax);

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

/** Consume a standalone declaration after leading whitespace, leaving its semicolon unread. */
// Extracted from https://drafts.csswg.org/css-syntax-3/#parse-declaration
function consumeSingleDeclaration(c: TokenCursor<Token>): Declaration | null {
  consumeTrivia(c);
  return consumeDeclaration(c);
}

/** Consume declaration syntax and priority; the owning grammar interprets the result. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-declaration
function consumeDeclaration<Value extends Token>(
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
  const valueEnd = c.pos();

  const removed = consumeImportantFlag(declaration) + trimTrailingWhitespace(declaration.value);

  if (declaration.name.startsWith('--')) {
    // TODO: Retain source provenance when declarations arrive as bare token or
    // component lists. Only string input and source-bearing cursors can supply it.
    // SPEC_CLASH(css-custom-property-boundary-comments): Keep token-span text,
    // matching Syntax and Chromium/WebKit; Firefox also retains trailing comments.
    declaration.originalText = c.sourceText(valueStart, valueEnd - removed);
  } else if (hasDisallowedTopLevelBraceBlock(declaration.value)) {
    return null;
  } else if (asciiLower(declaration.name) === 'unicode-range') {
    const originalText = c.sourceText(valueStart, valueEnd);
    // TODO: Bare token/component input has no original spelling to retokenize.
    // Connect source provenance before supporting descriptors through that path.
    if (originalText !== undefined) {
      declaration.value = consumeUnicodeRangeDescriptorValue(originalText);
    }
  }

  return declaration;
}

/** Recover through the next semicolon, or stop before the containing brace in nested input. */
// Bad-declaration recovery: https://drafts.csswg.org/css-syntax-3/#consume-declaration
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

/** Remove a final important flag and following whitespace, returning the removed token count. */
// Extracted from https://drafts.csswg.org/css-syntax-3/#consume-declaration
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

/** Locate the last significant component at or before start, or return -1. */
function lastNonWhitespaceIndex(
  values: ComponentValue[],
  start: number,
): number {
  for (let i = start; i >= 0; i--) {
    if (!isWhitespaceToken(values[i]!)) return i;
  }

  return -1;
}

/** Trim trailing whitespace and return the number of tokens removed. */
// Extracted from https://drafts.csswg.org/css-syntax-3/#consume-declaration
function trimTrailingWhitespace(values: ComponentValue[]): number {
  const start = values.length;

  while (values.length > 0 && isWhitespaceToken(values[values.length - 1]!)) {
    values.pop();
  }

  return start - values.length;
}

/** Detect a brace block mixed with another significant value in a non-custom declaration. */
// Extracted from https://drafts.csswg.org/css-syntax-3/#consume-declaration
function hasDisallowedTopLevelBraceBlock(values: ComponentValue[]): boolean {
  const significant = values.filter((value) => !isWhitespaceToken(value));
  const braces = significant.filter(isBraceBlock);

  return braces.length > 0 && (significant.length !== 1 || braces.length !== 1);
}

/** Consume components up to EOF, the stop token, or a containing brace in nested input. */
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

/** Consume a preserved token or fold an opening token into a block/function. */
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

/** Consume a simple block through its matching delimiter, closing it implicitly at EOF. */
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

/** Consume a function through its matching parenthesis, closing it implicitly at EOF. */
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

/** Retokenize a unicode-range descriptor's source; its grammar validates the resulting ranges. */
// CSS Syntax: https://drafts.csswg.org/css-syntax-3/#consume-unicode-range-value
function consumeUnicodeRangeDescriptorValue(input: string): ComponentValue[] {
  return parseListOfComponentValues(tokenize(input, true));
}
