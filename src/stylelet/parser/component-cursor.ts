import type { ComponentValue } from './syntax';
import type { TokenKind } from './tokens';

export type ComponentCursorOptions = {
  position?: number;
  context?: unknown;
};

export class ComponentCursor {
  private i: number;
  context: unknown;

  constructor(
    private readonly input: readonly ComponentValue[],
    options: ComponentCursorOptions = {},
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

  peek(k = 0): ComponentValue | null {
    return this.input[this.i + k] ?? null;
  }

  next(): ComponentValue | null {
    if (this.i >= this.input.length) {
      return null;
    }

    return this.input[this.i++]!;
  }

  consume(): ComponentValue {
    const value = this.next();

    if (value === null) {
      this.error('Unexpected end of component list');
    }

    return value;
  }

  match(kind: TokenKind): boolean {
    const value = this.peek();

    if (
      value === null ||
      !('kind' in value) ||
      value.kind !== kind
    ) {
      return false;
    }

    this.i++;
    return true;
  }

  error(message: string): never {
    throw new ComponentCursorError(message, this.i);
  }
}

export class ComponentCursorError extends SyntaxError {
  constructor(message: string, public position: number) {
    super(`${message} at component ${position}`);
    this.name = 'ComponentCursorError';
  }
}
