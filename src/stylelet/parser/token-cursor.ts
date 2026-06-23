import { EOFToken, type Token } from './tokens';

export class TokenCursor {
  constructor(
    private readonly input: readonly Token[],
    private i = 0,
  ) {}

  pos(): number {
    return this.i;
  }

  restore(pos: number): void {
    this.i = pos;
  }

  peek(k = 0): Token {
    return this.input[this.i + k] ?? EOFToken;
  }

  next(): Token {
    if (this.i >= this.input.length) {
      return EOFToken;
    }

    return this.input[this.i++];
  }
}
