import { describe, expect, it, vi } from 'vitest';

import { BlobImpl, FileImpl, FileListImpl } from '../../src/file/index';
import { createRuntime } from '../js-engine/runtime-fixture';

const runtime = createRuntime();

describe('File API §4: File', () => {
  it('extends Blob with captured name and modification metadata', async () => {
    const file = new FileImpl(['a\nb'], 'notes.txt', {
      endings: 'native',
      lastModified: 42,
      type: 'Text/PLAIN',
    }, runtime);

    expect(file).toBeInstanceOf(BlobImpl);
    expect(file.name).toBe('notes.txt');
    expect(file.lastModified).toBe(42);
    expect(file.type).toBe('text/plain');
    expect(new TextDecoder().decode(await file.data.read())).toBe('a\nb');
  });

  it('captures its default modification time once during construction', () => {
    let currentTime = 100;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => currentTime++);
    try {
      const file = new FileImpl([], 'empty', {}, runtime);
      expect(file.lastModified).toBe(100);
      expect(file.lastModified).toBe(100);
      expect(currentTime).toBe(101);
    } finally {
      clock.mockRestore();
    }
  });

  it('shares File parts through inherited Blob processing', async () => {
    const first = new FileImpl(['first'], 'first.txt', { lastModified: 1 }, runtime);
    const second = new FileImpl([first, '-second'], 'second.txt', { lastModified: 2 }, runtime);

    expect(new TextDecoder().decode(await second.data.read()))
      .toBe('first-second');
  });
});

describe('File API §5: FileList', () => {
  const first = new FileImpl([], 'first', { lastModified: 1 }, runtime);
  const second = new FileImpl([], 'second', { lastModified: 2 }, runtime);

  it('retains ordered File identity and returns null out of range', () => {
    const list = new FileListImpl([first, second]);

    expect(list.length).toBe(2);
    expect(list.item(0)).toBe(first);
    expect(list.item(1)).toBe(second);
    expect(list.item(2)).toBeNull();
    expect([...list]).toEqual([first, second]);
  });

  it('allows only implementation owners to replace or append files', () => {
    const list = new FileListImpl([first]);

    list.replace([second]);
    expect([...list]).toEqual([second]);
    list.add(first);
    expect([...list]).toEqual([second, first]);
  });
});
