export type CharPred = (ch: string) => boolean;

export class CursorError extends SyntaxError {
  constructor(
    message: string,
    public position: number,
  ) {
    super(`${message} at ${position}`);
    this.name = 'CursorError';
  }
}

export class Cursor {
  constructor(
    public readonly input: string,
    private i = 0,
  ) {}

  lookahead<R>(fn: (c: this) => R): R {
    const m = this.i;
    try {
      return fn(this);
    } finally {
      this.restore(m);
    }
  }

  mark(): number { return this.i; }

  pos(): number { return this.i; }
  len(): number { return this.input.length; }
  lenLeft(): number { return this.input.length - this.i; }

  eof(k = 0): boolean {
    const j = this.i + k;
    return j < 0 || j >= this.input.length;
  }

  peek(k = 0): string {
    return this.input[this.i + k] ?? '';
  }

  restore(pos: number): void {
    if (pos < 0 || pos > this.input.length) {
      throw new RangeError(`Bad cursor restore: ${pos}`);
    }
    this.i = pos;
  }

  next(): string {
    if (this.i >= this.input.length) return '';
    return this.input[this.i++];
  }

  match(ch: string): boolean {
    if (ch.length !== 1) throw new RangeError('match() expects one character');
    if (this.peek() !== ch) return false;
    this.i++;
    return true;
  }

  startsWith(text: string): boolean {
    return this.input.startsWith(text, this.i);
  }

  matchString(text: string): boolean {
    if (text.length === 0) throw new RangeError('matchString() expects non-empty text');
    if (!this.startsWith(text)) return false;
    this.i += text.length;
    return true;
  }

  consume(k = 1): number {
    if (k <= 0) return 0;

    const start = this.i;
    this.i = Math.min(this.i + k, this.input.length);
    return this.i - start;
  }

  consumeWhile(p: CharPred, limit = Number.POSITIVE_INFINITY): number {
    const start = this.i;
    let n = 0;

    while (this.i < this.input.length && n < limit && p(this.input[this.i])) {
      this.i++;
      n++;
    }

    return this.i - start;
  }

  expect(ch: string): void {
    if (ch.length !== 1) throw new RangeError('expect() expects one character');
    if (this.peek() !== ch) this.error(`Expected ${JSON.stringify(ch)}`);
    this.i++;
  }

  expectString(text: string): void {
    if (text.length === 0) throw new RangeError('expectString() expects non-empty text');
    if (!this.startsWith(text)) this.error(`Expected ${JSON.stringify(text)}`);
    this.i += text.length;
  }

  slice(start: number, end = this.i): string {
    return this.input.slice(start, end);
  }

  error(message: string): never {
    throw new CursorError(message, this.i);
  }
}
