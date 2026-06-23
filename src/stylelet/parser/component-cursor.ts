// component-cursor.ts
import type { ComponentValue } from './syntax';

export class ComponentCursor {
  constructor(
    private readonly input: readonly ComponentValue[],
    private i = 0,
  ) {}

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

    return this.input[this.i++];
  }

  consume(): ComponentValue {
    const value = this.next();

    if (value === null) {
      throw new Error('consumeComponentValue called at end of component list');
    }

    return value;
  }
}
