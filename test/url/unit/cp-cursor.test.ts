import { describe, expect, it } from 'vitest';

import { CodePointCursor } from '../../../src/url/cp-cursor';

describe('CodePointCursor', () => {
  it('traverses Unicode code points rather than UTF-16 code units', () => {
    const cursor = new CodePointCursor('A\u{1F4A9}B');

    expect(cursor.consume()).toBe('A');
    expect(cursor.pos()).toBe(1);
    expect(cursor.consume()).toBe('\u{1F4A9}');
    expect(cursor.pos()).toBe(2);
    expect(cursor.consume()).toBe('B');
    expect(cursor.pos()).toBe(3);
  });

  it('restores a saved position', () => {
    const cursor = new CodePointCursor('abc');

    cursor.consume();
    const position = cursor.pos();
    cursor.consume();
    cursor.restore(position);

    expect(cursor.peek()).toBe('b');
  });

  it('keeps its position within the input bounds', () => {
    const cursor = new CodePointCursor('abc');

    cursor.restore(-1);
    expect(cursor.pos()).toBe(0);

    cursor.restore(4);
    expect(cursor.pos()).toBe(3);
    expect(cursor.eof()).toBe(true);
    expect(cursor.consume()).toBe('');
    expect(cursor.pos()).toBe(3);
  });
});
