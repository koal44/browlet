import { isomorphicEncode } from '@exodus/bytes/encoding-lite.js';
import { describe, expect, it } from 'vitest';

import { parseMultipartFormData } from '../../../src/fetch/multipart/parse';
import { FileImpl, readBlobBytes } from '../../../src/file/index';
import { parseMIMEType } from '../../../src/mime/index';

const mimeType = parseMIMEType('multipart/form-data; boundary=Boundary')!;

describe('Fetch multipart/form-data parsing', () => {
  it('preserves order, repeated names, and empty names and values', () => {
    expect(parse(
      '--Boundary\r\nContent-Disposition: form-data; name="key"\r\n\r\none\r\n' +
      '--Boundary\r\nContent-Disposition: form-data; name=""\r\n\r\n\r\n' +
      '--Boundary\r\nContent-Disposition: form-data; name="key"\r\n\r\ntwo\r\n' +
      '--Boundary--\r\n',
    )).toEqual([['key', 'one'], ['', ''], ['key', 'two']]);
  });

  it('decodes names, filenames, and text as UTF-8 while preserving BOMs', async () => {
    const bytes = new TextEncoder().encode(
      '--Boundary\r\nContent-Disposition: form-data; name="é💩"\r\n\r\n\ufeff日本\r\n' +
      '--Boundary\r\nContent-Disposition: form-data; name="file"; filename="日本.txt"\r\n\r\n' +
      '\ufeffcontent\r\n--Boundary--\r\n',
    );
    const entries = parseMultipartFormData(bytes, mimeType);
    expect(entries[0]).toEqual(['é💩', '\ufeff日本']);
    const file = entries[1]![1] as FileImpl;
    expect(file.name).toBe('日本.txt');
    expect(await readBlobBytes(file)).toEqual(new TextEncoder().encode('\ufeffcontent'));
  });

  it('ignores charset declarations and replaces malformed UTF-8 in text', () => {
    expect(parse(
      '--Boundary\r\nContent-Disposition: form-data; name="_charset_"\r\n\r\nwindows-1252\r\n' +
      '--Boundary\r\nContent-Disposition: form-data; name="text"\r\n' +
      'Content-Type: text/plain; charset=windows-1252\r\n\r\n\xff\x80\r\n' +
      '--Boundary--\r\n',
    )).toEqual([['_charset_', 'windows-1252'], ['text', '\ufffd\ufffd']]);
  });

  it('keeps binary file bytes and copies them out of the input buffer', async () => {
    const bytes = Uint8Array.from(isomorphicEncode(part(
      'Content-Disposition: form-data; name="file"; filename="a.bin"\r\n' +
      'Content-Type: Application/Octet-Stream',
      '\0\xff\r\n\x80\n',
    )));
    const [name, value] = parseMultipartFormData(bytes, mimeType)[0]!;
    expect(name).toBe('file');
    expect(value).toBeInstanceOf(FileImpl);
    const file = value as FileImpl;
    expect(file.name).toBe('a.bin');
    expect(file.type).toBe('application/octet-stream');
    bytes.fill(0);
    expect(await readBlobBytes(file)).toEqual(Uint8Array.of(0, 255, 13, 10, 128, 10));
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
    expect(parseMultipartFormData(bytes, type)).toEqual([]);
    expect(() => parseMultipartFormData(bytes, {
      ...type, parameters: new Map([['boundary', 'b: a']]),
    })).toThrow(TypeError);
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
      expect(() => parseMultipartFormData(new Uint8Array(), type))
        .toThrow(TypeError);
    },
  );
});

function parse(body: string) {
  return parseMultipartFormData(Uint8Array.from(isomorphicEncode(body)), mimeType);
}

function part(headers: string, body: string): string {
  return `--Boundary\r\n${headers}\r\n\r\n${body}\r\n--Boundary--\r\n`;
}
