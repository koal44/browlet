import {
  EOFToken, TokenKind,
  type ComponentValue, type Token,
} from './tokens';
import type { TokenList } from './token-list';

/** Optional initial position within an existing token list. */
export type TokenCursorOptions = {
  /** Index of the next token to consume; omitted starts at the beginning. */
  position?: number;
};

/** Predicate used to consume a consecutive run of matching tokens. */
export type TokenPredicate<Value extends Token> = (token: Value) => boolean;

/** Component-grammar consumer whose failure leaves the input available to another production. */
export type TryConsumer<T, Context = unknown> =
  (c: TokenCursor<ComponentValue, Context>) => TryConsumerResult<T>;

/**
 * Try consumers use two channels:
 *
 *   null        = this consumer did not match this production. The consumer
 *                 must leave the cursor position and context unchanged, so
 *                 the caller may safely try another production.
 *
 *   value       = this consumer matched a valid construct. The cursor usually
 *                 advances, but nullable productions may succeed without
 *                 consuming input.
 */
export type TryConsumerResult<T> = T | null;

/** A token stream with retained source ranges and the caller's current grammar context. */
// https://drafts.csswg.org/css-syntax-3/#parser-definitions
export class TokenCursor<Value extends Token = ComponentValue, Context = unknown> {
  /** Grammar state selected by the caller or a temporarily scoped nested consumer. */
  context: Context;
  /** Original input text and the source range corresponding to each retained token. */
  source: TokenList<Value>;
  /** Tokens or folded component values traversed by this cursor. */
  #input: Value[];
  /** Index of the next token to read. */
  #i: number;

  /** Traverse an existing list without copying its tokens or source metadata. */
  constructor(
    list: TokenList<Value>,
    context: Context,
    options?: TokenCursorOptions,
  ) {
    this.#input = list.tokens;
    this.#i = options?.position ?? 0;
    this.context = context;
    this.source = list;
  }

  /** Current token index, suitable for saving before an optional grammar production. */
  pos(): number {
    return this.#i;
  }

  /** Return to a saved token index without changing the source or grammar context. */
  restore(pos: number): void {
    this.#i = pos;
  }

  /** Whether the next token is the end-of-input marker. */
  eof(): boolean {
    return this.peek().type === TokenKind.EOF;
  }

  /** Read ahead without advancing, returning EOF beyond the retained input. */
  peek(k = 0): Value | typeof EOFToken {
    return this.#input[this.#i + k] ?? EOFToken;
  }

  /** Consume the next retained token, or return EOF without advancing past the input. */
  next(): Value | typeof EOFToken {
    if (this.#i >= this.#input.length) {
      return EOFToken;
    }

    return this.#input[this.#i++]!;
  }

  /** Consume a required token, throwing a cursor diagnostic at end of input. */
  consume(): Value {
    const token = this.next();

    if (token.type === TokenKind.EOF) {
      this.error('Unexpected end of token stream');
    }

    return token;
  }

  /** Consume consecutive matching tokens and return their count. */
  consumeWhile(predicate: TokenPredicate<Value>): number {
    const start = this.#i;

    while (this.#i < this.#input.length && predicate(this.#input[this.#i]!)) {
      this.#i++;
    }

    return this.#i - start;
  }

  /** Consume one token only when its kind matches, reporting whether it was consumed. */
  match(kind: Value['type']): boolean {
    if (this.peek().type !== kind) return false;

    this.#i++;
    return true;
  }

  /** Use a context for synchronous consumption, preserving position/source and restoring the caller's context. */
  withContext<ScopedContext, Result>(
    context: ScopedContext,
    consume: (cursor: TokenCursor<Value, ScopedContext>) => Result,
  ): Result {
    const previous = this.context;
    // The same cursor changes context only for this call; no token/source copy is needed.
    const scoped = this as unknown as TokenCursor<Value, ScopedContext>;
    scoped.context = context;
    try {
      return consume(scoped);
    } finally {
      this.context = previous;
    }
  }

  /** Read the original text for the token interval [start, end). */
  sourceText(start: number, end: number): string {
    return this.source.sourceText(start, end);
  }

  /** Throw a parsing diagnostic at the current token index. */
  error(message: string): never {
    throw new TokenCursorError(message, this.#i);
  }
}

/** Internal parsing diagnostic with the token position where consumption failed. */
// eslint-disable-next-line no-restricted-globals -- Cursor diagnostics are not requests for a realm-owned exception.
export class TokenCursorError extends SyntaxError {
  /** Record the failing token position and include it in the diagnostic message. */
  constructor(message: string, public position: number) {
    super(`${message} at token ${position}`);
    this.name = 'TokenCursorError';
  }
}
