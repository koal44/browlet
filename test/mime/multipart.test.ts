import { describe, expect, it } from 'vitest';

import { MultipartParser, type MultipartHeaders } from '../../src/mime/index';
import { isomorphicDecode, isomorphicEncode } from '../../src/js-engine/index';

describe('RFC 2046 streaming multipart framing', () => {
  const message = 'ignored preamble\r\n--sample boundary \t\r\n' +
    'Content-Type: text/plain\r\nX-Test: first\r\nX-Test: second\r\n\tfolded \t\r\n\r\n' +
    'first body\r\n\r\n--sample boundary\r\n\r\n' +
    '\x00\x80\xff\rnot a boundary\r\n--sample boundarX\r\n--sample boundary-- \t\r\nignored epilogue';
  const expected: Part[] = [
    {
      headers: [['Content-Type', 'text/plain'], ['X-Test', 'first'], ['X-Test', 'second\tfolded']],
      body: 'first body\r\n', complete: true,
    },
    { headers: [], body: '\x00\x80\xff\rnot a boundary\r\n--sample boundarX', complete: true },
  ];

  it('delivers headers and body before the next boundary or transport EOF', () => {
    const { parser, parts } = collect('b');
    expect(parser.appendData(bytes('--b\r\nContent-Type: text/plain\r\n\r\nhello'))).toBe(true);
    expect(parts).toEqual([{ headers: [['Content-Type', 'text/plain']], body: 'hello', complete: false }]);
    expect(parser.appendData(bytes(' world\r\n--b\r\n\r\nsecond'))).toBe(true);
    expect(parts).toEqual([
      { headers: [['Content-Type', 'text/plain']], body: 'hello world', complete: true },
      { headers: [], body: 'second', complete: false },
    ]);
    expect(parser.appendData(bytes('\r\n--b--'))).toBe(true);
    expect(parser.finish()).toBe(true);
    expect(parts[1]?.complete).toBe(true);
  });

  it('preserves fields and binary bodies across every two-chunk split', () => {
    const input = bytes(message);
    for (let split = 0; split <= input.length; split++) {
      const { parser, parts } = collect('sample boundary');
      expect(parser.appendData(input.subarray(0, split)), `first append at ${split}`).toBe(true);
      expect(parser.appendData(input.subarray(split)), `second append at ${split}`).toBe(true);
      expect(parser.finish(), `finish at ${split}`).toBe(true);
      expect(parts, `split at ${split}`).toEqual(expected);
    }
  });

  it('reports part EOF at the boundary without waiting for transport EOF or the next headers', () => {
    const { parser, parts } = collect('b');
    expect(parser.appendData(bytes('--b\r\n\r\nfirst\r\n--b'))).toBe(true);
    expect(parts).toEqual([{ headers: [], body: 'first', complete: true }]);
    expect(parser.appendData(bytes('\r\n\r\nsecond\r\n--b--'))).toBe(true);
    expect(parts[1]).toEqual({ headers: [], body: 'second', complete: true });
    expect(parser.finish()).toBe(true);
  });

  it('preserves framing when every byte arrives separately', () => {
    const { parser, parts } = collect('sample boundary');
    for (const byte of bytes(message)) expect(parser.appendData(Uint8Array.of(byte))).toBe(true);
    expect(parser.finish()).toBe(true);
    expect(parts).toEqual(expected);
  });

  it('excludes the delimiter CRLF and preserves an explicit body CRLF', () => {
    const { parser, parts } = collect('b');
    expect(parser.appendData(bytes('--b\r\n\r\n\r\n--b\r\n\r\n\r\n\r\n--b--\r\n'))).toBe(true);
    expect(parser.finish()).toBe(true);
    expect(parts.map((part) => part.body)).toEqual(['', '\r\n']);
  });

  it('matches only at line beginnings and replays failed delimiter prefixes', () => {
    const body = 'middle--b\n--b\r\r\n--x\r\n-b\r\n--a\r\n--';
    const { parser, parts } = collect('b');
    for (const byte of bytes(`--b\r\n\r\n${body}\r\n--b--`)) {
      expect(parser.appendData(Uint8Array.of(byte))).toBe(true);
    }
    expect(parser.finish()).toBe(true);
    expect(parts[0]?.body).toBe(body);
  });

  it('forwards an ordinary body chunk without copying or retaining the whole part', () => {
    const chunks: Uint8Array[] = [];
    const parser = new MultipartParser('b', {
      onPartHeaders() {}, onPartData(chunk) { chunks.push(chunk); }, onPartEnd() {},
    });
    expect(parser.appendData(bytes('--b\r\n\r\n'))).toBe(true);
    const body = new Uint8Array(1024 * 1024).fill(0x61);
    expect(parser.appendData(body)).toBe(true);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.buffer).toBe(body.buffer);
    expect(chunks[0]?.byteLength).toBe(body.byteLength);
    expect(parser.appendData(bytes('\r\n--b--'))).toBe(true);
    expect(parser.finish()).toBe(true);
  });

  it('preserves body views from an offset input across headers, delimiters, and later appends', () => {
    const chunks: Uint8Array[] = [];
    const parser = new MultipartParser('b', {
      onPartHeaders() {}, onPartData(chunk) { if (chunk.length) chunks.push(chunk); }, onPartEnd() {},
    });
    const prefix = '--b\r\nX-Test: value\r\n\r\n';
    const storage = bytes(`padding${prefix}first\r\n--b\r\n\r\nsecond`);
    const input = storage.subarray('padding'.length);
    expect(parser.appendData(input)).toBe(true);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.buffer).toBe(storage.buffer);
    expect(chunks[0]?.byteOffset).toBe(input.byteOffset + prefix.length);
    expect(chunks[1]?.buffer).toBe(storage.buffer);
    expect(chunks[1]?.byteOffset).toBe(storage.byteOffset + storage.length - 'second'.length);
    expect(parser.appendData(bytes('\r\n--b--\r\nignored epilogue'))).toBe(true);
    expect(parser.finish()).toBe(true);
    expect(chunks.map(isomorphicDecode)).toEqual(['first', 'second']);
  });

  it('leaves nested multipart bytes and transfer encodings to the part consumer', () => {
    const body = '--inner\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n--inner--';
    const { parser, parts } = collect('outer');
    expect(parser.appendData(bytes('--outer\r\nContent-Type: multipart/mixed; boundary=inner\r\n\r\n' +
      body + '\r\n--outer--'))).toBe(true);
    expect(parser.finish()).toBe(true);
    expect(parts).toEqual([{
      headers: [['Content-Type', 'multipart/mixed; boundary=inner']], body, complete: true,
    }]);
  });

  it('retains uninterpreted header bytes and does not synthesize a content type', () => {
    const { parser, parts } = collect('b');
    expect(parser.appendData(bytes('--b\r\nX-Bytes: \x80\xff\r\n\r\na\r\n--b--'))).toBe(true);
    expect(parser.finish()).toBe(true);
    expect(parts[0]?.headers).toEqual([['X-Bytes', '\x80\xff']]);
  });

  it('accepts the full boundary alphabet, internal spaces, and the 70-byte limit', () => {
    for (const boundary of ["'()+_,-./:=? A0z", 'a'.repeat(70)]) {
      const { parser, parts } = collect(boundary);
      expect(parser.appendData(bytes(`--${boundary}\r\n\r\na\r\n--${boundary}--`))).toBe(true);
      expect(parser.finish()).toBe(true);
      expect(parts[0]?.body).toBe('a');
    }
  });

  it('rejects invalid boundary parameters before consuming input', () => {
    for (const boundary of ['', 'a'.repeat(71), 'b ', 'b\t', 'b\n', 'b"', 'é', 'b[']) {
      expect(() => collect(boundary), boundary).toThrow('Invalid multipart boundary');
    }
  });

  it.each([
    '--b!\r\n\r\nx\r\n--b--',
    '--b\rX',
    '--b\r\nno colon\r\n\r\n',
    '--b\r\n continued without a field\r\n\r\n',
    '--b\r\nBad Name: x\r\n\r\n',
    '--b\r\nX: \x00\r\n\r\n',
    '--b\r\nX: \x7f\r\n\r\n',
    '--b\r\nX: y\n\n',
    '--b\r\n\r\nx\r\n--b-X',
    '--b\r\n\r\nx\r\n--b--X',
    '--b--\r\n',
  ])('stops on malformed framing: %j', (input) => {
    const { parser, parts } = collect('b');
    expect(parser.appendData(bytes(input))).toBe(false);
    const saved = structuredClone(parts);
    expect(parser.appendData(bytes('--b\r\n\r\nignored\r\n--b--'))).toBe(false);
    expect(parser.finish()).toBe(false);
    expect(parts).toEqual(saved);
  });

  it.each([
    '', 'preamble', '--b', '--b\r\nX: partial', '--b\r\n\r\nbody', '--b\r\n\r\nbody\r\n--',
  ])('does not complete an unfinished entity at EOF: %j', (input) => {
    const { parser, parts } = collect('b');
    expect(parser.appendData(bytes(input))).toBe(true);
    expect(parser.finish()).toBe(false);
    expect(parts.every((part) => !part.complete)).toBe(true);
  });

  it('distinguishes a completed part from an incomplete closing delimiter', () => {
    for (const suffix of ['-', '--\r']) {
      const { parser, parts } = collect('b');
      expect(parser.appendData(bytes(`--b\r\n\r\nbody\r\n--b${suffix}`))).toBe(true);
      expect(parts[0]?.complete).toBe(true);
      expect(parser.finish()).toBe(false);
    }
  });

  it.each(['headers', 'data', 'end'] as const)('permits cancellation from the %s callback', (cancelAt) => {
    const calls: string[] = [];
    const notify = (kind: string): void => {
      calls.push(kind);
      if (kind === cancelAt) parser.cancel();
    };
    const parser = new MultipartParser('b', {
      onPartHeaders() { notify('headers'); }, onPartData() { notify('data'); }, onPartEnd() { notify('end'); },
    });
    expect(parser.appendData(bytes('--b\r\n\r\nfirst\r\n--b\r\n\r\nsecond\r\n--b--'))).toBe(false);
    expect(calls).toEqual(['headers', 'data', 'end'].slice(0, ['headers', 'data', 'end'].indexOf(cancelAt) + 1));
    expect(parser.appendData(bytes('ignored'))).toBe(false);
    expect(parser.finish()).toBe(false);
  });

  it('ignores the epilogue and makes finish idempotent without reopening input', () => {
    const { parser, parts } = collect('b');
    expect(parser.appendData(bytes('--b\r\n\r\nfirst\r\n--b--\r\n'))).toBe(true);
    expect(parser.appendData(bytes('--b\r\n\r\nnot a part'))).toBe(true);
    expect(parser.finish()).toBe(true);
    expect(parser.finish()).toBe(true);
    expect(parser.appendData(bytes('after finish'))).toBe(false);
    expect(parts).toEqual([{ headers: [], body: 'first', complete: true }]);
  });
});

type Part = { headers: MultipartHeaders; body: string; complete: boolean; };

function collect(boundary: string): { parser: MultipartParser; parts: Part[]; } {
  const parts: Part[] = [];
  const parser = new MultipartParser(boundary, {
    onPartHeaders(headers) { parts.push({ headers, body: '', complete: false }); },
    onPartData(chunk) { parts.at(-1)!.body += isomorphicDecode(chunk); },
    onPartEnd() { parts.at(-1)!.complete = true; },
  });
  return { parser, parts };
}

function bytes(value: string): Uint8Array {
  return isomorphicEncode(value);
}
