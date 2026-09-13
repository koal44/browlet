import { isomorphicEncode } from '../../../src/js-engine/byte-string';
import { describe, expect, it, vi } from 'vitest';

import type { Encoding } from '../../../src/encoding/encodings';
import { encodeMultipartFormData } from '../../../src/fetch/multipart/encode';
import { BlobData, FileImpl } from '../../../src/file/index';
import { toScalarValueString } from '../../../src/infra/index';
import { parseMIMEType } from '../../../src/mime/index';
import type { FormDataEntry } from '../../../src/xhr/index';
import { createRuntime } from '../../js-engine/runtime-fixture';

const runtime = createRuntime();

describe('HTML multipart/form-data encoding', () => {
  it('leaves File byte sources unread when preparing the body', async () => {
    const read = vi.fn(() => Promise.resolve(Uint8Array.of(7)));
    const file = new FileImpl([], 'deferred.bin', {}, runtime);
    file.setSerializationState({
      data: BlobData.fromSource({ size: 1, snapshotState: undefined, read }),
      type: '', snapshotState: undefined,
    });

    const { boundary, data } = encodeMultipartFormData([entry('file', file)], 'UTF-8');
    const header = isomorphicEncode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="deferred.bin"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n',
    );
    const ending = isomorphicEncode(`\r\n--${boundary}--\r\n`);

    expect(read).not.toHaveBeenCalled();
    expect(data.size).toBe(header.length + 1 + ending.length);
    expect(await data.read(0, header.length)).toEqual(header);
    expect(read).not.toHaveBeenCalled();
    expect(await data.read(header.length, 1)).toEqual(Uint8Array.of(7));
    expect(read).toHaveBeenCalledExactlyOnceWith(0, 1);
    expect(await data.read(header.length + 1)).toEqual(ending);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('encodes ordered text fields and preserves duplicate and empty names', async () => {
    const entries = [entry('name', 'Eric'), entry('', ''), entry('name', 'again')];
    const { boundary, bytes } = await readEncoding(entries);
    expect(bytes).toEqual(isomorphicEncode(
      `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nEric\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name=""\r\n\r\n\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nagain\r\n` +
      `--${boundary}--\r\n`,
    ));
    expect(entries).toEqual([entry('name', 'Eric'), entry('', ''), entry('name', 'again')]);
  });

  it('encodes an empty entry list with the closing delimiter', async () => {
    const { boundary, bytes } = await readEncoding([]);
    expect(bytes).toEqual(isomorphicEncode(`--${boundary}--\r\n`));
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
    const { boundary, bytes } = await readEncoding([entry(name, 'value')]);
    expect(bytes).toEqual(isomorphicEncode(
      `--${boundary}\r\nContent-Disposition: form-data; name="${expectedName}"\r\n\r\n` +
      `value\r\n--${boundary}--\r\n`,
    ));
  });

  it.each([
    ['a\nb', 'a%0Ab'],
    ['a\rb', 'a%0Db'],
    ['a\r\nb', 'a%0D%0Ab'],
    ['a"b', 'a%22b'],
    ['a\\b%0A +\0', 'a\\b%0A +\0'],
  ])('escapes filename %j without normalizing its line endings', async (name, expectedName) => {
    const file = new FileImpl([], name, { type: 'text/plain' }, runtime);
    const { boundary, bytes } = await readEncoding([entry('file', file)]);
    expect(bytes).toEqual(isomorphicEncode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; ` +
      `filename="${expectedName}"\r\nContent-Type: text/plain\r\n\r\n` +
      `\r\n--${boundary}--\r\n`,
    ));
    expect(file.name).toBe(name);
  });

  it('normalizes text values while leaving quotes and percent signs alone', async () => {
    const value = 'a\rb\nc\r\nd\n\r"%0A+\0';
    const { boundary, bytes } = await readEncoding([entry('text', value)]);
    expect(bytes).toEqual(isomorphicEncode(
      `--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\n` +
      `a\r\nb\r\nc\r\nd\r\n\r\n"%0A+\0\r\n--${boundary}--\r\n`,
    ));
  });

  it('encodes names, filenames, and text as UTF-8 without stripping a BOM', async () => {
    const entries = [entry('é', '\ufeff💩'), entry('file', new FileImpl([], '日本.txt', {}, runtime))];
    const { boundary, bytes } = await readEncoding(entries);
    expect(bytes).toEqual(new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="é"\r\n\r\n\ufeff💩\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="日本.txt"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n\r\n--${boundary}--\r\n`,
    ));
  });

  it('uses the chosen legacy encoding and character references for names and values', async () => {
    const entries = [entry('é€💩', 'é€💩%80'), entry('file', new FileImpl([], 'é💩.txt', {}, runtime))];
    const { boundary, bytes } = await readEncoding(entries, 'windows-1252');
    expect(bytes).toEqual(isomorphicEncode(
      `--${boundary}\r\nContent-Disposition: form-data; name="\xe9\x80&#128169;"\r\n\r\n` +
      '\xe9\x80&#128169;%80\r\n' +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="\xe9&#128169;.txt"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n\r\n--${boundary}--\r\n`,
    ));
  });

  it('keeps multiple files as separate parts with unchanged binary contents', async () => {
    const data = new Uint8Array([0, 0xff, 13, 10, 13, 34, 0x25]);
    const first = new FileImpl([data], 'one.bin', { type: 'Application/Example' }, runtime);
    const second = new FileImpl([], 'two.bin', {}, runtime);
    const { boundary, bytes } = await readEncoding([
      entry('files', first), entry('files', second),
    ]);
    const prefix = isomorphicEncode(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="one.bin"\r\n` +
      'Content-Type: application/example\r\n\r\n',
    );
    const suffix = isomorphicEncode(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="two.bin"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n\r\n--${boundary}--\r\n`,
    );
    expect(bytes).toEqual(new Uint8Array([...prefix, ...data, ...suffix]));
    await expect(first.data.read()).resolves.toEqual(data);
  });

  it('captures entries, file metadata, and byte sources during encoding', async () => {
    let finishRead!: (bytes: Uint8Array) => void;
    const pending = new Promise<Uint8Array>((resolve) => { finishRead = resolve; });
    const file = new FileImpl([], 'before.txt', { type: 'text/plain' }, runtime);
    file.setSerializationState({
      data: BlobData.fromSource({ size: 3, snapshotState: undefined, read: () => pending }),
      type: file.type, snapshotState: undefined,
    });
    const entries = [entry('original', file), entry('second', 'a\nb')];
    const { boundary, data } = encodeMultipartFormData(entries, 'UTF-8');
    entries[1] = entry('replacement', 'different');
    entries.push(entry('later', 'entry'));
    file.setFileSerializationState({ name: 'after.txt', lastModified: 123 });
    file.setSerializationState({
      data: BlobData.fromBytes(isomorphicEncode('replacement')),
      type: 'text/html', snapshotState: undefined,
    });
    const bytes = data.read();
    finishRead(isomorphicEncode('abc'));
    expect(await bytes).toEqual(isomorphicEncode(
      `--${boundary}\r\nContent-Disposition: form-data; name="original"; filename="before.txt"\r\n` +
      'Content-Type: text/plain\r\n\r\nabc\r\n' +
      `--${boundary}\r\nContent-Disposition: form-data; name="second"\r\n\r\na\r\nb\r\n` +
      `--${boundary}--\r\n`,
    ));
  });

  it('propagates a file failure when reading the encoded body', async () => {
    const failure = new Error('file snapshot unavailable');
    const file = new FileImpl([], 'broken', {}, runtime);
    file.setSerializationState({
      data: BlobData.fromSource({
        size: 1, snapshotState: undefined, read: () => Promise.reject(failure),
      }),
      type: '', snapshotState: undefined,
    });
    const { data } = encodeMultipartFormData([entry('file', file)], 'UTF-8');
    await expect(data.read()).rejects.toBe(failure);
  });
});

describe('RFC 2046 §5.1.1: multipart boundaries', () => {
  it('generates a fresh boundary that can be used directly in Content-Type', () => {
    const first = encodeMultipartFormData([], 'UTF-8');
    const second = encodeMultipartFormData([], 'UTF-8');
    expect(first.boundary).not.toBe(second.boundary);
    for (const { boundary } of [first, second]) {
      expect(boundary).toMatch(/^[0-9A-Za-z'()+_,\-./:=? ]{0,69}[0-9A-Za-z'()+_,\-./:=?]$/);
      expect(parseMIMEType(`multipart/form-data; boundary=${boundary}`)?.parameters.get('boundary'))
        .toBe(boundary);
    }
  });
});

async function readEncoding(entries: FormDataEntry[], encoding: Encoding = 'UTF-8') {
  const { boundary, data } = encodeMultipartFormData(entries, encoding);
  return { boundary, bytes: await data.read() };
}

function entry(name: string, value: string | FileImpl): FormDataEntry {
  return [toScalarValueString(name), typeof value === 'string' ? toScalarValueString(value) : value];
}
