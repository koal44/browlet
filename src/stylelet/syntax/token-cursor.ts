import {
  EOFToken, TokenKind,
  type ComponentValue, type Token, type TokenSourceRange,
} from './tokens';

/** Source text and ranges parallel to this cursor's tokens; prebuilt blocks need their own ranges. */
export type TokenSource = {
  text: string;
  ranges: TokenSourceRange[];
};

export type TokenCursorOptions = {
  position?: number;
  source?: TokenSource;
};

/** Shared context for component grammars that need no contextual state. */
export const emptyParsingContext = Object.freeze({});

export type TokenPredicate<Value extends Token> = (value: Value) => boolean;

export type TryConsumer<T> =
  (c: TokenCursor<ComponentValue>) => TryConsumerResult<T>;

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

export class TokenCursor<Value extends Token = ComponentValue, Context = unknown> {
  context: Context;
  #input: Value[];
  #i: number;
  #source?: TokenSource;

  constructor(
    input: Value[],
    context: Context,
    options?: TokenCursorOptions,
  ) {
    this.#input = input;
    this.#i = options?.position ?? 0;
    this.context = context;
    this.#source = options?.source;
  }

  pos(): number {
    return this.#i;
  }

  restore(pos: number): void {
    this.#i = pos;
  }

  eof(): boolean {
    return this.peek().type === TokenKind.EOF;
  }

  peek(k = 0): Value | typeof EOFToken {
    return this.#input[this.#i + k] ?? EOFToken;
  }

  next(): Value | typeof EOFToken {
    if (this.#i >= this.#input.length) {
      return EOFToken;
    }

    return this.#input[this.#i++]!;
  }

  consume(): Value {
    const value = this.next();

    if (value.type === TokenKind.EOF) {
      this.error('Unexpected end of token stream');
    }

    return value;
  }

  consumeWhile(predicate: TokenPredicate<Value>): number {
    const start = this.#i;

    while (this.#i < this.#input.length && predicate(this.#input[this.#i]!)) {
      this.#i++;
    }

    return this.#i - start;
  }

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

  /** Read the source span of [start, end), or undefined when the cursor has no matching ranges. */
  sourceText(start: number, end: number): string | undefined {
    if (this.#source === undefined) return undefined;
    if (start === end) return '';

    const first = this.#source.ranges[start];
    const last = this.#source.ranges[end - 1];
    if (first === undefined || last === undefined) return undefined;

    return this.#source.text.slice(first.start, last.end);
  }

  error(message: string): never {
    throw new TokenCursorError(message, this.#i);
  }
}

// eslint-disable-next-line no-restricted-globals -- Cursor diagnostics are not requests for a realm-owned exception.
export class TokenCursorError extends SyntaxError {
  constructor(message: string, public position: number) {
    super(`${message} at token ${position}`);
    this.name = 'TokenCursorError';
  }
}
