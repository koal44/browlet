import { isomorphicDecode, isomorphicEncode } from '@exodus/bytes/encoding-lite.js';
import { describe, expect, it, vi } from 'vitest';

import { encodeMultipartFormData } from '../../../src/fetch/multipart/encode';
import { BlobData, BlobImpl, FileImpl, readBlobBytes } from '../../../src/file/index';
import { toScalarValueString } from '../../../src/infra/index';
import type { FormDataEntry } from '../../../src/xhr/index';

const boundary = 'test-boundary';

describe('HTML multipart/form-data encoding', () => {
  it('encodes ordered text fields and preserves duplicate and empty names', async () => {
    const entries = [entry('name', 'Eric'), entry('', ''), entry('name', 'again')];
    const result = await encodeMultipartFormData(entries, () => boundary);
    expect(result.boundary).toBe(boundary);
    expect(result.bytes).toEqual(isomorphicEncode(
      '--test-boundary\r\nContent-Disposition: form-data; name="name"\r\n\r\nEric\r\n' +
      '--test-boundary\r\nContent-Disposition: form-data; name=""\r\n\r\n\r\n' +
      '--test-boundary\r\nContent-Disposition: form-data; name="name"\r\n\r\nagain\r\n' +
      '--test-boundary--\r\n',
    ));
    expect(entries).toEqual([entry('name', 'Eric'), entry('', ''), entry('name', 'again')]);
  });

  it('encodes an empty entry list with the closing delimiter', async () => {
    const { bytes } = await encodeMultipartFormData([], () => boundary);
    expect(bytes).toEqual(isomorphicEncode('--test-boundary--\r\n'));
  });

  // Independent cases also covered by WPT form-submission-0/multipart-formdata.window.js.
  it.each([
    ['a\nb', 'a%0D%0Ab'],
    ['a\rb', 'a%0D%0Ab'],
    ['a\r\nb', 'a%0D%0Ab'],
    ['a\n\rb', 'a%0D%0A%0D%0Ab'],
    ['a"b', 'a%22b'],
    ['a\\b%0A +\0', 'a\\b%0A +\0'],
  ])('normalizes and escapes the field name %j', async (name, expectedName) => {
    const { bytes } = await encodeMultipartFormData([entry(name, 'value')], () => boundary);
    expect(bytes).toEqual(isomorphicEncode(
      `--test-boundary\r\nContent-Disposition: form-data; name="${expectedName}"\r\n\r\n` +
      'value\r\n--test-boundary--\r\n',
    ));
  });

  it.each([
    ['a\nb', 'a%0Ab'],
    ['a\rb', 'a%0Db'],
    ['a\r\nb', 'a%0D%0Ab'],
    ['a"b', 'a%22b'],
    ['a\\b%0A +\0', 'a\\b%0A +\0'],
  ])('escapes filename %j without normalizing its line endings', async (name, expectedName) => {
    const file = new FileImpl([], name, { type: 'text/plain' });
    const { bytes } = await encodeMultipartFormData([entry('file', file)], () => boundary);
    expect(bytes).toEqual(isomorphicEncode(
      '--test-boundary\r\nContent-Disposition: form-data; name="file"; ' +
      `filename="${expectedName}"\r\nContent-Type: text/plain\r\n\r\n` +
      '\r\n--test-boundary--\r\n',
    ));
    expect(file.name).toBe(name);
  });

  it('normalizes text values while leaving quotes and percent signs alone', async () => {
    const value = 'a\rb\nc\r\nd\n\r"%0A+\0';
    const { bytes } = await encodeMultipartFormData([entry('text', value)], () => boundary);
    expect(bytes).toEqual(isomorphicEncode(
      '--test-boundary\r\nContent-Disposition: form-data; name="text"\r\n\r\n' +
      'a\r\nb\r\nc\r\nd\r\n\r\n"%0A+\0\r\n--test-boundary--\r\n',
    ));
  });

  it('encodes names, filenames, and text as UTF-8 without stripping a BOM', async () => {
    const entries = [entry('é', '\ufeff💩'), entry('file', new FileImpl([], '日本.txt'))];
    const { bytes } = await encodeMultipartFormData(entries, () => boundary);
    expect(bytes).toEqual(new TextEncoder().encode(
      '--test-boundary\r\nContent-Disposition: form-data; name="é"\r\n\r\n\ufeff💩\r\n' +
      '--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="日本.txt"\r\n' +
      'Content-Type: application/octet-stream\r\n\r\n\r\n--test-boundary--\r\n',
    ));
  });

  it('uses the chosen legacy encoding and character references for names and values', async () => {
    const entries = [entry('é€💩', 'é€💩%80'), entry('file', new FileImpl([], 'é💩.txt'))];
    const { bytes } = await encodeMultipartFormData(entries, () => boundary, 'windows-1252');
    expect(bytes).toEqual(isomorphicEncode(
      '--test-boundary\r\nContent-Disposition: form-data; name="\xe9\x80&#128169;"\r\n\r\n' +
      '\xe9\x80&#128169;%80\r\n' +
      '--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="\xe9&#128169;.txt"\r\n' +
      'Content-Type: application/octet-stream\r\n\r\n\r\n--test-boundary--\r\n',
    ));
  });

  it('keeps multiple files as separate parts with unchanged binary contents', async () => {
    const data = new Uint8Array([0, 0xff, 13, 10, 13, 34, 0x25]);
    const first = new FileImpl([data], 'one.bin', { type: 'Application/Example' });
    const second = new FileImpl([], 'two.bin');
    const { bytes } = await encodeMultipartFormData([
      entry('files', first), entry('files', second),
    ], () => boundary);
    const prefix = isomorphicEncode(
      '--test-boundary\r\nContent-Disposition: form-data; name="files"; filename="one.bin"\r\n' +
      'Content-Type: application/example\r\n\r\n',
    );
    const suffix = isomorphicEncode(
      '\r\n--test-boundary\r\nContent-Disposition: form-data; name="files"; filename="two.bin"\r\n' +
      'Content-Type: application/octet-stream\r\n\r\n\r\n--test-boundary--\r\n',
    );
    expect(bytes).toEqual(new Uint8Array([...prefix, ...data, ...suffix]));
    await expect(readBlobBytes(first)).resolves.toEqual(data);
  });

  it('captures the complete entry list and file metadata before awaiting reads', async () => {
    let finishRead!: (bytes: Uint8Array) => void;
    const pending = new Promise<Uint8Array>((resolve) => { finishRead = resolve; });
    const file = new FileImpl([], 'before.txt', { type: 'text/plain' });
    BlobImpl.setSerializationState(file, {
      data: BlobData.fromSource({ size: 3, snapshotState: undefined, read: () => pending }),
      type: file.type, snapshotState: undefined,
    });
    const entries = [entry('original', file), entry('second', 'a\nb')];
    const result = encodeMultipartFormData(entries, () => boundary);
    entries[1] = entry('replacement', 'different');
    entries.push(entry('later', 'entry'));
    FileImpl.setHostMetadata(file, 'after.txt', 123);
    finishRead(isomorphicEncode('abc'));
    expect((await result).bytes).toEqual(isomorphicEncode(
      '--test-boundary\r\nContent-Disposition: form-data; name="original"; filename="before.txt"\r\n' +
      'Content-Type: text/plain\r\n\r\nabc\r\n' +
      '--test-boundary\r\nContent-Disposition: form-data; name="second"\r\n\r\na\r\nb\r\n' +
      '--test-boundary--\r\n',
    ));
  });

  it('propagates a file read failure without producing a partial body', async () => {
    const failure = new Error('file snapshot unavailable');
    const file = new FileImpl([], 'broken');
    BlobImpl.setSerializationState(file, {
      data: BlobData.fromSource({
        size: 1, snapshotState: undefined, read: () => Promise.reject(failure),
      }),
      type: '', snapshotState: undefined,
    });
    await expect(encodeMultipartFormData([entry('file', file)], () => boundary))
      .rejects.toBe(failure);
  });
});

describe('RFC 2046 §5.1.1: multipart boundaries', () => {
  it.each(['', 'x'.repeat(71), 'trailing ', 'line\nbreak', 'final\n', 'final\r', 'é', 'a"b'])(
    'rejects an invalid generated boundary: %j',
    async (invalid) => {
      await expect(encodeMultipartFormData([], () => invalid)).rejects.toThrow(TypeError);
    },
  );

  it.each(['x', 'x'.repeat(70), "'()+_,-./:=? middle end"])(
    'accepts valid boundary syntax: %j',
    async (valid) => {
      const { bytes, boundary: actual } = await encodeMultipartFormData([], () => valid);
      expect(actual).toBe(valid);
      expect(bytes).toEqual(isomorphicEncode(`--${valid}--\r\n`));
    },
  );

  it.each([
    { field: entry('text', 'before\r\n--collision\r\nafter') },
    { field: entry('--collision', 'value') },
    { field: entry('file', new FileImpl(['\r\n--collision\r\n'], 'file.bin')) },
  ])('regenerates a delimiter that occurs in a part: %j', async ({ field }) => {
    const generate = vi.fn().mockReturnValueOnce('collision').mockReturnValue('safe');
    const result = await encodeMultipartFormData([field], generate);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.boundary).toBe('safe');
    expect(isomorphicDecode(result.bytes)).toContain('--collision');
    expect(isomorphicDecode(result.bytes)).toMatch(/^--safe\r\n/);
    expect(isomorphicDecode(result.bytes)).toContain('\r\n--safe--\r\n');
  });

  it('preserves a partial delimiter at the end of a value', async () => {
    const generate = vi.fn(() => boundary);
    const result = await encodeMultipartFormData([entry('text', '--test-boun')], generate);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(isomorphicDecode(result.bytes)).toContain('\r\n\r\n--test-boun\r\n--test-boundary--');
  });
});

function entry(name: string, value: string | FileImpl): FormDataEntry {
  return [toScalarValueString(name), typeof value === 'string' ? toScalarValueString(value) : value];
}
