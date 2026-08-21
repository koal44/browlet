/*
 * URL parsing operates on Unicode code points. The caller is responsible for
 * supplying the scalar-value string required by the URL Standard; this cursor
 * only provides bounded traversal and saved-position restoration.
 */
export class CodePointCursor {
  private readonly codePoints: string[];
  private i = 0;

  constructor(public readonly input: string) {
    this.codePoints = Array.from(input);
  }

  pos(): number {
    return this.i;
  }

  restore(pos: number): void {
    this.i = Math.max(0, Math.min(pos, this.codePoints.length));
  }

  eof(k = 0): boolean {
    return this.i + k >= this.codePoints.length;
  }

  peek(k = 0): string {
    return this.codePoints[this.i + k] ?? '';
  }

  consume(): string {
    if (this.eof()) return '';

    return this.codePoints[this.i++]!;
  }
}

export function isURLCodePoint(codePoint: string): boolean {
  if (/^[\dA-Za-z!$&'()*+,\-./:;=?@_~]$/u.test(codePoint)) return true;

  const value = codePoint.codePointAt(0);
  return value !== undefined && value >= 0xa0 && value <= 0x10fffd &&
    !isNoncharacter(value);
}

function isNoncharacter(codePoint: number): boolean {
  return codePoint >= 0xfdd0 && codePoint <= 0xfdef ||
    (codePoint & 0xffff) >= 0xfffe;
}
