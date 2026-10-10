import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { createTestDocument } from '../../../support/dom';

describe('CharacterData', () => {
  it.each(['Text', 'Comment'] as const)('reads and edits %s in UTF-16 code units', async (kind) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate((kind) => {
      const node = kind === 'Text' ? new Text('A\u{1f600}B') : new Comment('A\u{1f600}B');
      const original = [node.length, node.substringData(1, 1), node.substringData(2, 1), node.substringData(3, 99)];
      node.appendData('C');
      node.insertData(1, 'x');
      node.deleteData(2, 2);
      const edited = node.data;
      node.replaceData(1, 99, '!');
      return [original, edited, node.data, node.length, node.substringData(node.length, 10)];
    }, kind)).toEqual([[4, '\ud83d', '\ude00', 'B'], 'AxBC', 'A!', 2, '']);
  });

  it('converts unsigned offsets and nullable data at the Web IDL boundary', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const text = new Text('abc');
      const substring = text.substringData(2 ** 32 + 1.9, -1);
      text.insertData(NaN, 'x');
      const inserted = text.data;
      Reflect.set(text, 'data', null);
      const nullValue = text.data;
      Reflect.set(text, 'data', undefined);
      const undefinedValue = text.data;
      Reflect.set(text, 'data', { toString: () => 'converted' });
      return [substring, inserted, nullValue, undefinedValue, text.data];
    })).toEqual(['bc', 'xabc', '', 'undefined', 'converted']);
  });

  it('rejects invalid offsets without changing the text or its live selection', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const text = new Text('abc');
      const range = new Range();
      range.selectNodeContents(text);
      const errors: unknown[] = [];
      for (const action of [
        () => text.substringData(4, 0), () => text.insertData(-1, 'x'),
        () => text.deleteData(4, 0), () => text.replaceData(4, 0, 'x'),
      ]) {
        try { action(); } catch (error) {
          errors.push([error instanceof DOMException, (error as DOMException).name]);
        }
      }
      return [errors, text.data, range.startOffset, range.endOffset];
    })).toEqual([Array.from({ length: 4 }, () => [true, 'IndexSizeError']), 'abc', 0, 3]);
  });

  it('finishes argument conversion before reading the current text length', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const text = new Text('a');
      const offset = { valueOf: () => { text.data = 'abcd'; return 3; } };
      return text.substringData(offset as unknown as number, 1);
    })).toBe('d');
  });

  it.each([
    [2, 2, 'X', 'abXef', [0, 1, 2, 2, 2, 4, 5]],
    [2, 0, 'XY', 'abXYcdef', [0, 1, 2, 5, 6, 7, 8]],
    [2, 99, '', 'ab', [0, 1, 2, 2, 2, 2, 2]],
  ] as const)('adjusts both range endpoints for replacement at %i with count %i', async (offset, count, data, expected, offsets) => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(({ offset, count, data }) => {
      const text = new Text('abcdef');
      const ranges = Array.from({ length: 7 }, (_, index) => {
        const range = new Range();
        range.setStart(text, index);
        range.collapse(true);
        return range;
      });
      text.replaceData(offset, count, data);
      return [text.data, ranges.map((range) => [range.startOffset, range.endOffset])];
    }, { offset, count, data })).toEqual([expected, offsets.map((value) => [value, value])]);
  });

  it('adjusts live ranges even when assigned data is unchanged, while StaticRange stays fixed', async () => {
    const browlet = new Browlet({ route: () => '' });
    expect(await browlet.evaluate(() => {
      const text = new Text('abc');
      const live = new Range();
      live.setStart(text, 1);
      live.setEnd(text, 3);
      const snapshot = new StaticRange({ startContainer: text, startOffset: 1, endContainer: text, endOffset: 3 });
      const data = text.data;
      text.data = data;
      return [text.data, live.startOffset, live.endOffset, snapshot.startOffset, snapshot.endOffset];
    })).toEqual(['abc', 0, 0, 1, 3]);
  });

  it('queues the old value before replacement and notifies the parent after range adjustment', () => {
    const document = createTestDocument();
    const text = document.createTextNode('abcd');
    document.createElement('parent').appendChild(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    const observed: unknown[] = [];
    vi.spyOn(text, 'queueMutationRecord').mockImplementation((_type, _name, _namespace, oldValue) => {
      observed.push(['record', oldValue, text.data, range.endOffset]);
    });
    vi.spyOn(text, 'notifyParentChildrenChanged').mockImplementation(() => {
      observed.push(['parent', text.data, range.endOffset]);
    });
    text.replaceData(1, 3, 'X');
    text.appendData('');
    expect(observed).toEqual([
      ['record', 'abcd', 'abcd', 4], ['parent', 'aX', 1],
      ['record', 'aX', 'aX', 1], ['parent', 'aX', 1],
    ]);
  });
});
