import { describe, expect, it } from 'vitest';
import { processDataURL } from '../../../src/fetch/schemes/data';
import { InternalError } from '../../../src/infra/internal-error';
import { serializeMIMEType } from '../../../src/mime/index';
import { copyURL, parseURL } from '../../../src/url/url';

describe('Fetch §6: data URL processing', () => {
  it('decodes a plain body with the default MIME type', () => {
    const result = processDataURL(parseURL('data:,hello%20world').url!);
    expect(serializeMIMEType(result!.mimeType)).toBe('text/plain;charset=US-ASCII');
    expect(result!.body).toEqual(new TextEncoder().encode('hello world'));
  });

  it.each<[string, number[]]>([
    ['data:,', []],
    ['DATA:,X', [88]],
    ['data:,a,b,c', [97, 44, 98, 44, 99]],
    ['data:,a+b', [97, 43, 98]],
    ['data:,a?b', [97, 63, 98]],
    ['data:,%00%7f%80%FF', [0, 127, 128, 255]],
    ['data:,%2520', [37, 50, 48]],
    ['data:,%2g%2%', [37, 50, 103, 37, 50, 37]],
    ['data:,é💩', [195, 169, 240, 159, 146, 169]],
    ['data:text/plain;charset=windows-1252,é', [195, 169]],
    ['data:application/octet-stream,a b', [97, 32, 98]],
    ['data:,a%20%0A', [97, 32, 10]],
    ['data:,a%23b#omitted', [97, 35, 98]],
    ['data:text/plain;a=",",X', [34, 44, 88]],
    ['data://example.test/,X', [88]],
  ])('preserves the decoded bytes of %j', (input, bytes) => {
    expect(processDataURL(parseURL(input).url!)!.body).toEqual(Uint8Array.from(bytes));
  });

  it('excludes the fragment without changing the URL record', () => {
    const url = parseURL('data:,body?query#fragment').url!;
    const original = copyURL(url);
    expect(processDataURL(url)!.body).toEqual(new TextEncoder().encode('body?query'));
    expect(url).toEqual(original);
  });

  // Representative cases from WPT fetch/data-urls/resources/data-urls.json.
  it.each([
    ['data:text/plain,X', 'text/plain'],
    ['data: TEXT/PLAIN ;Charset=UTF-8 ,X', 'text/plain;charset=UTF-8'],
    ['data:;charset=UTF-8,X', 'text/plain;charset=UTF-8'],
    ['data:;x=y,X', 'text/plain;x=y'],
    ['data:;charset=,X', 'text/plain'],
    ['data:;charset =x,X', 'text/plain'],
    ['data:;charset= x,X', 'text/plain;charset=" x"'],
    ['data:text/plain;charset=UTF-8;charset=US-ASCII,X', 'text/plain;charset=UTF-8'],
    ['data:text/plain;a="x y",X', 'text/plain;a="x y"'],
    ['data:text/plain;a=",",X', 'text/plain;a=""'],
    ['data:text/plain;a=%2C,X', 'text/plain;a=%2C'],
    ['data:text/plain%20,X', 'text/plain%20'],
    ['data:text/plain\f,X', 'text/plain%0c'],
    ['data:invalid;charset=UTF-8,X', 'text/plain;charset=US-ASCII'],
    ['data:text /plain,X', 'text/plain;charset=US-ASCII'],
    ['data: ;base64,WA', 'text/plain;charset=US-ASCII'],
    ['data:;base64;base64,WA', 'text/plain'],
  ])('parses the media type of %j', (input, expected) => {
    expect(serializeMIMEType(processDataURL(parseURL(input).url!)!.mimeType)).toBe(expected);
  });

  it.each<[string, number[]]>([
    ['data:;base64,', []],
    ['data:;base64,WA==', [88]],
    ['data:;base64,WA', [88]],
    ['data:;base64,YR', [97]],
    ['data:;base64,AP8=', [0, 255]],
    ['data:;base64,%2BA%3D%3D', [248]],
    ['data:;base64,W%09%0A%0C%0D%20A==', [88]],
    ['data:;  BASE64  ,WA==', [88]],
    ['data:text/plain;charset=UTF-8;base64,WA==', [88]],
    ['data:invalid;base64,WA==', [88]],
    ['data:;base64,WA==#ignored', [88]],
  ])('applies forgiving Base64 decoding to %j', (input, bytes) => {
    expect(processDataURL(parseURL(input).url!)!.body).toEqual(Uint8Array.from(bytes));
  });

  it.each([
    'data:text/plain;base64;charset=UTF-8,WA',
    'data:text/plain;base64;,WA',
    'data:;base64=x,WA',
    'data:;base64x,WA',
    'data:;base 64,WA',
    'data:;%62ase64,WA',
    'data:%3Bbase64,WA',
    'data:;%20base64,WA',
  ])('leaves bytes unchanged without a trailing Base64 marker in %j', (input) => {
    expect(processDataURL(parseURL(input).url!)!.body).toEqual(Uint8Array.of(87, 65));
  });

  it.each([
    'data:', 'data:text/plain', 'data:text/plain#ignored,body', 'data:text/plain%2Cbody',
    'data:;base64,A', 'data:;base64,WA=', 'data:;base64,WA===', 'data:;base64,W=A=',
    'data:;base64,-A', 'data:;base64,_A', 'data:;base64,W%0BA', 'data:;base64,W%C2%A0A',
    'data:;base64,%FF', 'data:;base64,%252B',
  ])('returns failure for %j', (input) => {
    expect(processDataURL(parseURL(input).url!)).toBeNull();
  });

  it('returns independent default MIME type records', () => {
    const first = processDataURL(parseURL('data:,first').url!)!;
    first.mimeType.parameters.set('charset', 'UTF-8');
    const second = processDataURL(parseURL('data:,second').url!)!;
    expect(second.mimeType.parameters.get('charset')).toBe('US-ASCII');
  });

  it('requires a data URL from its caller', () => {
    expect(() => processDataURL(parseURL('https://example.test/').url!)).toThrow(InternalError);
  });
});
