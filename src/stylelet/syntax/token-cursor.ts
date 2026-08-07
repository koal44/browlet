import { EOFToken, TokenKind, type ComponentValue, type Token } from './tokens';

export type TokenCursorOptions = {
  position?: number;
  context?: unknown;
};

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

export class TokenCursor<Value extends Token = ComponentValue> {
  private i: number;
  context: unknown;

  constructor(
    private readonly input: readonly Value[],
    options: TokenCursorOptions = {},
  ) {
    this.i = options.position ?? 0;
    this.context = options.context;
  }

  pos(): number {
    return this.i;
  }

  restore(pos: number): void {
    this.i = pos;
  }

  eof(): boolean {
    return this.peek().type === TokenKind.EOF;
  }

  peek(k = 0): Value | typeof EOFToken {
    return this.input[this.i + k] ?? EOFToken;
  }

  next(): Value | typeof EOFToken {
    if (this.i >= this.input.length) {
      return EOFToken;
    }

    return this.input[this.i++]!;
  }

  consume(): Value {
    const value = this.next();

    if (value.type === TokenKind.EOF) {
      this.error('Unexpected end of token stream');
    }

    return value;
  }

  consumeWhile(predicate: TokenPredicate<Value>): number {
    const start = this.i;

    while (this.i < this.input.length && predicate(this.input[this.i]!)) {
      this.i++;
    }

    return this.i - start;
  }

  match(kind: Value['type']): boolean {
    if (this.peek().type !== kind) return false;

    this.i++;
    return true;
  }

  error(message: string): never {
    throw new TokenCursorError(message, this.i);
  }
}

export class TokenCursorError extends SyntaxError {
  constructor(message: string, public position: number) {
    super(`${message} at token ${position}`);
    this.name = 'TokenCursorError';
  }
}
