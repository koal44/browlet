export type CharPred = (ch: string) => boolean;

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
    throw new CursorError(message, this.i, this.input);
  }
}

export class SelectorSyntaxError extends SyntaxError {
  constructor(message: string) {
    super(message);
    this.name = 'SelectorSyntaxError';
  }
}

export class CursorError extends SelectorSyntaxError {
  constructor(message: string, public position: number, input?: string) {
    const at = `${message} at ${position}`;
    const fmt = input ? formatInput(input, position) : '';

    super(`${at}\n${fmt}`);
    this.name = 'CursorError';
  }
}

function formatInput(input: string, position: number, radius = 80): string {
  const label = 'Input: ';
  const start = Math.max(0, position - radius);
  const end = Math.min(input.length, position + radius);

  const head = start ? '…' : '';
  const tail = end < input.length ? '…' : '';
  const excerpt = head + input.slice(start, end) + tail;
  const before = head + input.slice(start, position);

  const caretAt = label.length + JSON.stringify(before).length - 1;

  return `${label}${JSON.stringify(excerpt)}\n${' '.repeat(caretAt)}^`;
}
