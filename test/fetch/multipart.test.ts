import { describe, expect, it, vi } from 'vitest';
import type { Encoding } from '../../src/encoding/encodings';
import { encodeMultipartFormData, parseMultipartFormData } from '../../src/fetch/multipart';
import { BlobData, FileImpl } from '../../src/file/index';
import { toScalarValueString } from '../../src/infra/index';
import { isomorphicEncode } from '../../src/js-engine/byte-string';
import { parseMIMEType } from '../../src/mime/index';
import type { FormDataEntry } from '../../src/xhr/index';
import { createEnvironment } from '../js-engine/execution-fixture';

const env = createEnvironment();
const mimeType = parseMIMEType('multipart/form-data; boundary=Boundary')!;

describe('HTML multipart/form-data encoding', () => {
  it('encodes an empty entry list with the closing delimiter', async () => {
    const { boundary, bytes } = await readEncoding([]);
    expect(bytes).toEqual(isomorphicEncode(`--${boundary}--\r\n`));
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

  it('keeps multiple files as separate parts with unchanged binary contents', async () => {
    const data = new Uint8Array([0, 0xff, 13, 10, 13, 34, 0x25]);
    const first = new FileImpl([data], 'one.bin', { type: 'Application/Example' }, env);
    const second = new FileImpl([], 'two.bin', {}, env);
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

  it('normalizes text values while leaving quotes and percent signs alone', async () => {
    const value = 'a\rb\nc\r\nd\n\r"%0A+\0';
    const { boundary, bytes } = await readEncoding([entry('text', value)]);
    expect(bytes).toEqual(isomorphicEncode(
      `--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\n` +
      `a\r\nb\r\nc\r\nd\r\n\r\n"%0A+\0\r\n--${boundary}--\r\n`,
    ));
  });

  it.each([
    ['a\nb', 'a%0Ab'],
    ['a\rb', 'a%0Db'],
    ['a\r\nb', 'a%0D%0Ab'],
    ['a"b', 'a%22b'],
    ['a\\b%0A +\0', 'a\\b%0A +\0'],
  ])('escapes filename %j without normalizing its line endings', async (name, expectedName) => {
    const file = new FileImpl([], name, { type: 'text/plain' }, env);
    const { boundary, bytes } = await readEncoding([entry('file', file)]);
    expect(bytes).toEqual(isomorphicEncode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; ` +
      `filename="${expectedName}"\r\nContent-Type: text/plain\r\n\r\n` +
      `\r\n--${boundary}--\r\n`,
    ));
    expect(file.name).toBe(name);
  });

  it('encodes names, filenames, and text as UTF-8 without stripping a BOM', async () => {
    const entries = [entry('é', '\ufeff💩'), entry('file', new FileImpl([], '日本.txt', {}, env))];
    const { boundary, bytes } = await readEncoding(entries);
    expect(bytes).toEqual(new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="é"\r\n\r\n\ufeff💩\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="日本.txt"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n\r\n--${boundary}--\r\n`,
    ));
  });

  it('uses the chosen legacy encoding and character references for names and values', async () => {
    const entries = [entry('é€💩', 'é€💩%80'), entry('file', new FileImpl([], 'é💩.txt', {}, env))];
    const { boundary, bytes } = await readEncoding(entries, 'windows-1252');
    expect(bytes).toEqual(isomorphicEncode(
      `--${boundary}\r\nContent-Disposition: form-data; name="\xe9\x80&#128169;"\r\n\r\n` +
      '\xe9\x80&#128169;%80\r\n' +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="\xe9&#128169;.txt"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n\r\n--${boundary}--\r\n`,
    ));
  });

  it('leaves File byte sources unread when preparing the body', async () => {
    const read = vi.fn(() => Promise.resolve(Uint8Array.of(7)));
    const file = new FileImpl([], 'deferred.bin', {}, env);
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

  it('captures entries, file metadata, and byte sources during encoding', async () => {
    let finishRead!: (bytes: Uint8Array) => void;
    const pending = new Promise<Uint8Array>((resolve) => { finishRead = resolve; });
    const file = new FileImpl([], 'before.txt', { type: 'text/plain' }, env);
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
    const file = new FileImpl([], 'broken', {}, env);
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

describe('Fetch multipart/form-data parsing', () => {
  it('preserves order, repeated names, and empty names and values', () => {
    expect(parse(
      '--Boundary\r\nContent-Disposition: form-data; name="key"\r\n\r\none\r\n' +
      '--Boundary\r\nContent-Disposition: form-data; name=""\r\n\r\n\r\n' +
      '--Boundary\r\nContent-Disposition: form-data; name="key"\r\n\r\ntwo\r\n' +
      '--Boundary--\r\n',
    )).toEqual([['key', 'one'], ['', ''], ['key', 'two']]);
  });

  it('keeps binary file bytes and copies them out of the input buffer', async () => {
    const bytes = Uint8Array.from(isomorphicEncode(part(
      'Content-Disposition: form-data; name="file"; filename="a.bin"\r\n' +
      'Content-Type: Application/Octet-Stream',
      '\0\xff\r\n\x80\n',
    )));
    const [name, value] = parseMultipartFormData(bytes, mimeType, env)[0]!;
    expect(name).toBe('file');
    expect(value).toBeInstanceOf(FileImpl);
    const file = value as FileImpl;
    expect(file.name).toBe('a.bin');
    expect(file.type).toBe('application/octet-stream');
    bytes.fill(0);
    expect(await file.data.read()).toEqual(Uint8Array.of(0, 255, 13, 10, 128, 10));
  });

  it('retains repeated files as distinct entries', () => {
    const entries = parse(
      '--Boundary\r\nContent-Disposition: form-data; name=f; filename=a\r\n\r\none\r\n' +
      '--Boundary\r\nContent-Disposition: form-data; name=f; filename=b\r\n\r\ntwo\r\n' +
      '--Boundary--\r\n',
    );
    expect(entries.map(([name, file]) => [name, (file as FileImpl).name]))
      .toEqual([['f', 'a'], ['f', 'b']]);
    expect(entries[0]![1]).not.toBe(entries[1]![1]);
  });

  it('decodes names, filenames, and text as UTF-8 while preserving BOMs', async () => {
    const bytes = new TextEncoder().encode(
      '--Boundary\r\nContent-Disposition: form-data; name="é💩"\r\n\r\n\ufeff日本\r\n' +
      '--Boundary\r\nContent-Disposition: form-data; name="file"; filename="日本.txt"\r\n\r\n' +
      '\ufeffcontent\r\n--Boundary--\r\n',
    );
    const entries = parseMultipartFormData(bytes, mimeType, env);
    expect(entries[0]).toEqual(['é💩', '\ufeff日本']);
    const file = entries[1]![1] as FileImpl;
    expect(file.name).toBe('日本.txt');
    expect(await file.data.read()).toEqual(new TextEncoder().encode('\ufeffcontent'));
  });

  it('ignores charset declarations and replaces malformed UTF-8 in text', () => {
    expect(parse(
      '--Boundary\r\nContent-Disposition: form-data; name="_charset_"\r\n\r\nwindows-1252\r\n' +
      '--Boundary\r\nContent-Disposition: form-data; name="text"\r\n' +
      'Content-Type: text/plain; charset=windows-1252\r\n\r\n\xff\x80\r\n' +
      '--Boundary--\r\n',
    )).toEqual([['_charset_', 'windows-1252'], ['text', '\ufffd\ufffd']]);
  });

  it.each([
    ['', 'text/plain'],
    ['\r\nContent-Type:', ''],
    ['\r\nContent-Type: TEXT/PLAIN; Charset=UTF-8', 'text/plain; charset=utf-8'],
    ['\r\nContent-Type: not a mime type', 'not a mime type'],
    ['\r\nContent-Type: text/\xff', ''],
  ])('uses the File type for a part header %j', (header, expectedType) => {
    const [, file] = parse(part(
      'Content-Disposition: form-data; name="file"; filename=""' + header, '',
    ))[0]!;
    expect(file).toBeInstanceOf(FileImpl);
    expect((file as FileImpl).name).toBe('');
    expect((file as FileImpl).type).toBe(expectedType);
    expect((file as FileImpl).size).toBe(0);
  });

  it('does not infer a File from Content-Type or decode transfer encodings', () => {
    expect(parse(part(
      'Content-Disposition: form-data; name="text"\r\n' +
      'Content-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64',
      'aGVsbG8=',
    ))).toEqual([['text', 'aGVsbG8=']]);
  });

  it('preserves percent escapes and character references in parameters and text', () => {
    expect(parse(part(
      'Content-Disposition: form-data; name="a%0D%0A%22%FF&#65;"', '%41&#65;',
    ))).toEqual([['a%0D%0A%22%FF&#65;', '%41&#65;']]);
  });

  it('handles case-insensitive tokens, quoted pairs, and semicolons inside quotes', () => {
    expect(parse(part(
      'cOnTeNt-DiSpOsItIoN: FoRm-DaTa; NaMe = "a;\\"b\\\\c"', 'text',
    ))).toEqual([['a;"b\\c', 'text']]);
  });

  it('accepts MIME folding, comments, and unquoted parameter values', () => {
    expect(parse(part(
      'Content-Disposition: (part (comment)) form-data;\r\n\tname (field) = field\r\n' +
      'X-Ignored: header',
      'value',
    ))).toEqual([['field', 'value']]);
  });

  it('ignores unsupported parameters, including filename*', () => {
    expect(parse(part(
      "Content-Disposition: form-data; name=text; filename*=UTF-8''x.txt; extra=value",
      'value',
    ))).toEqual([['text', 'value']]);
  });
});

describe('RFC 2046 multipart framing', () => {
  it.each(['--Boundary--', '--Boundary--\r\n', '--Boundary-- \t\r\nepilogue'])(
    'accepts the empty form %j', (body) => { expect(parse(body)).toEqual([]); },
  );

  // WPT fetch/api/response/response-form-data.html exercises transport padding
  // and closing delimiters with or without the final CRLF.
  it.each(['', '\r\n', ' \t\r\nepilogue'])(
    'accepts preamble, transport padding, and closing suffix %j', (suffix) => {
      expect(parse(
        'preamble\r\n--Boundary \t\r\nContent-Disposition: form-data; name=a\r\n\r\n' +
        'one\r\n--Boundary\t \r\nContent-Disposition: form-data; name=b\r\n\r\n' +
        'two\r\n--Boundary--' + suffix,
      )).toEqual([['a', 'one'], ['b', 'two']]);
    },
  );

  it('only recognizes delimiter lines and keeps partial matches and data CRLFs', () => {
    const value = 'x--Boundary\r\n--Boundar\n--Boundary\r\n\r\n';
    expect(parse(part('Content-Disposition: form-data; name=a', value)))
      .toEqual([['a', value]]);
  });

  it('uses the case-sensitive boundary from an already parsed MIME type', () => {
    const type = parseMIMEType('Multipart/Form-Data; boundary="B: a"')!;
    const bytes = Uint8Array.from(isomorphicEncode('--B: a--\r\n'));
    expect(parseMultipartFormData(bytes, type, env)).toEqual([]);
    expect(() => parseMultipartFormData(bytes, {
      ...type, parameters: new Map([['boundary', 'b: a']]),
    }, env)).toThrow(TypeError);
  });

  it.each([
    '', '--Boundary', '--Boundary-', '--Boundary--junk\r\n',
    '--Boundary\n--Boundary--\r\n', '--Boundary\r--Boundary--\r\n',
    '--Boundary\r\n\r\n\r\n--Boundary--\r\n',
    '--Boundary \r\nContent-Disposition: form-data; name=a\r\n\r\nx',
    '--Boundary\r\nContent-Disposition: form-data; name=a\r\n\r\nx\r\n--Boundary-junk',
    '--Boundary\r\nContent-Disposition: form-data; name=a\r\n\r\nx\r\n--Boundary--\r',
  ])('rejects incomplete or malformed framing %j', (body) => {
    expect(() => parse(body)).toThrow(TypeError);
  });

  it.each([
    'Content-Type: text/plain',
    'Content-Disposition: attachment; name=a',
    'Content-Disposition: form-data',
    'Content-Disposition: form-data; name=',
    'Content-Disposition: form-data; name="unterminated',
    'Content-Disposition: form-data; name="a"junk',
    'Content-Disposition: form-data; name=a; name=b',
    'Content-Disposition: form-data; name=a\r\nContent-Disposition: form-data; name=b',
    'Content-Disposition: form-data; name=a\r\nContent-Type: a\r\nContent-Type: b',
    'Content-Disposition: form-data; name=a\r\nBad header',
    'Content-Disposition: form-data; name=a\nX-Header: b',
    'Content-Disposition: form-data (unterminated; name=a',
  ])('rejects malformed part headers %j', (headers) => {
    expect(() => parse(part(headers, 'value'))).toThrow(TypeError);
  });

  it('rejects the whole input when a later part is invalid', () => {
    expect(() => parse(
      '--Boundary\r\nContent-Disposition: form-data; name=a\r\n\r\nvalid\r\n' +
      '--Boundary\r\nContent-Type: text/plain\r\n\r\ninvalid\r\n--Boundary--\r\n',
    )).toThrow(TypeError);
  });

  it('requires the delimiter CRLF separately from the header separator', () => {
    expect(() => parse(
      '--Boundary\r\nContent-Disposition: form-data; name=a\r\n\r\n--Boundary--\r\n',
    )).toThrow(TypeError);
  });

  it.each([undefined, '', 'a\rb', 'a ', 'a'.repeat(71), 'é'])(
    'rejects an absent or invalid boundary %j', (boundary) => {
      const type = {
        ...mimeType,
        parameters: new Map(boundary === undefined ? [] : [['boundary', boundary]]),
      };
      expect(() => parseMultipartFormData(new Uint8Array(), type, env))
        .toThrow(TypeError);
    },
  );
});

async function readEncoding(entries: FormDataEntry[], encoding: Encoding = 'UTF-8') {
  const { boundary, data } = encodeMultipartFormData(entries, encoding);
  return { boundary, bytes: await data.read() };
}

function entry(name: string, value: string | FileImpl): FormDataEntry {
  return [toScalarValueString(name), typeof value === 'string' ? toScalarValueString(value) : value];
}

function parse(body: string) {
  return parseMultipartFormData(Uint8Array.from(isomorphicEncode(body)), mimeType, env);
}

function part(headers: string, body: string): string {
  return `--Boundary\r\n${headers}\r\n\r\n${body}\r\n--Boundary--\r\n`;
}
