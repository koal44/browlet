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

  pos(): number { return this.i; }

  eof(k = 0): boolean {
    return this.i + k >= this.input.length;
  }

  peek(k = 0): string {
    return this.input[this.i + k] ?? '';
  }

  restore(pos: number): void {
    this.i = pos;
  }

  next(): string {
    if (this.i >= this.input.length) return '';
    return this.input[this.i++];
  }

  // trusted, no eof check!
  advance(k = 1): void {
    this.i += k;
  }

  match(ch: string): boolean {
    if (this.input[this.i] !== ch) return false;
    this.i++;
    return true;
  }

  consume(k = 1): number {
    const start = this.i;
    const next = start + k;
    const n = this.input.length;

    this.i = next < n ? next : n;
    return this.i - start;
  }

  consumeWhile(p: CharPred): number {
    const input = this.input;
    const n = input.length;
    const start = this.i;
    let i = start;

    while (i < n && p(input[i])) i++;

    this.i = i;
    return i - start;
  }

  expect(ch: string): void {
    if (this.input[this.i] !== ch) this.error(`Expected ${JSON.stringify(ch)}`);
    this.i++;
  }

  slice(start: number, end = this.i): string {
    return this.input.slice(start, end);
  }

  error(message: string): never {
    throw new CursorError(message, this.i);
  }
}
