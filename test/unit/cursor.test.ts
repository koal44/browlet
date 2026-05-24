import { describe, it, expect } from 'vitest';
import { Cursor, CursorError } from '../../src/parser/cursor';

describe('Cursor status and peek', () => {
  it('reports position, length, remaining length, and eof', () => {
    const c = new Cursor('abc');

    expect(c.pos()).toBe(0);
    expect(c.eof()).toBe(false);
    expect(c.eof(2)).toBe(false);
    expect(c.eof(3)).toBe(true);
  });

  it('peek supports relative offsets and returns empty string out of bounds', () => {
    const c = new Cursor('xyz');
    c.restore(1);

    expect(c.peek()).toBe('y');
    expect(c.peek(1)).toBe('z');
    expect(c.peek(2)).toBe('');
    expect(c.peek(-1)).toBe('x');
    expect(c.peek(-2)).toBe('');
  });
});

describe('Cursor', () => {
  it('match() consumes one matching character and is atomic on failure', () => {
    const c = new Cursor('ABC');

    expect(c.match('A')).toBe(true);
    expect(c.pos()).toBe(1);

    expect(c.match('A')).toBe(false);
    expect(c.pos()).toBe(1);

    expect(c.match('B')).toBe(true);
    expect(c.pos()).toBe(2);
  });

  it('expect() consumes a required character and throws on mismatch', () => {
    const c = new Cursor('ABC');

    expect(() => c.expect('A')).not.toThrow();
    expect(c.pos()).toBe(1);

    const p0 = c.pos();
    expect(() => c.expect('Z')).toThrow();
    expect(c.pos()).toBe(p0);
  });

  it('empty input is stable at EOF', () => {
    const c = new Cursor('');

    expect(c.pos()).toBe(0);
    expect(c.eof()).toBe(true);

    expect(c.peek()).toBe('');
    expect(c.next()).toBe('');
    expect(c.pos()).toBe(0);

    expect(c.consumeWhile(() => true)).toBe(0);
    expect(c.consume(10)).toBe(0);

    expect(() => c.expect('x')).toThrow();
  });

  it('slice returns spans without moving the cursor', () => {
    const c = new Cursor('abcdef');

    c.consume(3);

    expect(c.slice(0)).toBe('abc');
    expect(c.slice(1, 3)).toBe('bc');
    expect(c.pos()).toBe(3);
  });

  it('next is stable at EOF', () => {
    const c = new Cursor('a');

    expect(c.next()).toBe('a');
    expect(c.next()).toBe('');
    expect(c.next()).toBe('');
    expect(c.pos()).toBe(1);
  });

});

describe('Cursor consumeWhile', () => {
  it('consumes matching characters, returns count, and leaves the first non-match', () => {
    const c = new Cursor('  xy z');

    expect(c.consumeWhile(ch => ch === ' ')).toBe(2);
    expect(c.pos()).toBe(2);
    expect(c.peek()).toBe('x');

    expect(c.consumeWhile(ch => ch !== ' ')).toBe(2);
    expect(c.pos()).toBe(4);
    expect(c.peek()).toBe(' ');

    expect(c.consumeWhile(ch => ch === ' ')).toBe(1);
    expect(c.pos()).toBe(5);
    expect(c.peek()).toBe('z');
  });

  it('respects limit', () => {
    const c = new Cursor('abcdef');

    expect(c.consumeWhile(ch => /[a-c]/.test(ch))).toBe(3);
    expect(c.pos()).toBe(3);
    expect(c.peek()).toBe('d');
  });

  it('returns zero and does not advance when the first character does not match', () => {
    const c = new Cursor('abc');

    expect(c.consumeWhile(ch => ch === ' ')).toBe(0);
    expect(c.pos()).toBe(0);
    expect(c.peek()).toBe('a');
  });
});

describe('Cursor eof', () => {
  it('eof mirrors empty peek at current position', () => {
    const c = new Cursor('x');

    expect(c.peek()).toBe('x');
    expect(c.eof()).toBe(false);
    expect(c.eof(1)).toBe(true);

    expect(c.next()).toBe('x');
    expect(c.peek()).toBe('');
    expect(c.eof()).toBe(true);
  });
});

describe('Cursor errors', () => {
  it('throws CursorError with current position', () => {
    const c = new Cursor('let=42');
    c.consume(3);

    try {
      c.expect('x');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CursorError);
      expect((e as CursorError).position).toBe(3);
    }
  });
});
