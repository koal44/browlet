import { describe, expect, it } from 'vitest';

import {
  BlobImpl, FileImpl, FileListImpl, readBlobBytes,
} from '../../../src/file/index';

describe('File API §4: File', () => {
  it('extends Blob with captured name and modification metadata', async () => {
    const file = new FileImpl(
      ['a\nb'],
      'notes.txt',
      {
        endings: 'native',
        lastModified: 42,
        type: 'Text/PLAIN',
      },
      '\n',
    );

    expect(file).toBeInstanceOf(BlobImpl);
    expect(file.name).toBe('notes.txt');
    expect(file.lastModified).toBe(42);
    expect(file.type).toBe('text/plain');
    expect(new TextDecoder().decode(await readBlobBytes(file))).toBe('a\nb');
  });

  it('captures its default modification time once during construction', () => {
    let currentTime = 100;
    const file = new FileImpl(
      [],
      'empty',
      {},
      undefined,
      () => currentTime++,
    );

    expect(file.lastModified).toBe(100);
    expect(file.lastModified).toBe(100);
    expect(currentTime).toBe(101);
  });

  it('shares File parts through inherited Blob processing', async () => {
    const first = new FileImpl(
      ['first'],
      'first.txt',
      { lastModified: 1 },
    );
    const second = new FileImpl(
      [first, '-second'],
      'second.txt',
      { lastModified: 2 },
    );

    expect(new TextDecoder().decode(await readBlobBytes(second)))
      .toBe('first-second');
  });
});

describe('File API §5: FileList', () => {
  const first = new FileImpl(
    [],
    'first',
    { lastModified: 1 },
  );
  const second = new FileImpl(
    [],
    'second',
    { lastModified: 2 },
  );

  it('retains ordered File identity and returns null out of range', () => {
    const list = new FileListImpl([first, second]);

    expect(list.length).toBe(2);
    expect(list.item(0)).toBe(first);
    expect(list.item(1)).toBe(second);
    expect(list.item(2)).toBeNull();
    expect([...list]).toEqual([first, second]);
    expect(list.getSupportedPropertyIndices()).toEqual(new Set([0, 1]));
  });

  it('allows only implementation owners to replace or append files', () => {
    const list = new FileListImpl([first]);

    list.replace([second]);
    expect([...list]).toEqual([second]);
    list.add(first);
    expect([...list]).toEqual([second, first]);
  });
});
