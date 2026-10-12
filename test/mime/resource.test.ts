import { describe, expect, it } from 'vitest';

import { parseMIMEType, serializeMIMEType, type MIMEType } from '../../src/mime/mime-type';
import { detectSuppliedMIMEType } from '../../src/mime/resource';

describe('MIME Sniffing §5.1: detecting a supplied MIME type', () => {
  for (const value of [
    'text/plain',
    'text/plain; charset=ISO-8859-1',
    'text/plain; charset=iso-8859-1',
    'text/plain; charset=UTF-8',
  ]) {
    it(`sets the Apache-bug flag for exact ${value} bytes`, () => {
      const detected = detectSuppliedMIMEType({
        kind: 'http',
        contentType: value,
      });

      expect(detected.checkForApacheBug).toBe(true);
      expect(serializeMIMEType(detected.suppliedMIMEType!))
        .toBe(serializeMIMEType(requiredMIMEType(value)));
    });
  }

  it('parses the supplied HTTP field without losing byte-string parameter values', () => {
    const detected = detectSuppliedMIMEType({
      kind: 'http',
      contentType: 'IMAGE/PNG;NAME="caf\u00e9"',
    });

    expect(detected.checkForApacheBug).toBe(false);
    expect(serializeMIMEType(detected.suppliedMIMEType!))
      .toBe('image/png;name="caf\u00e9"');
  });

  it('compares the legacy HTTP value case-sensitively and exactly', () => {
    for (const value of [
      'TEXT/PLAIN',
      'text/plain; charset=utf-8',
      'text/plain; charset=UTF-8 ',
      'text/plain; charset=UTF-8;param=x',
    ]) {
      expect(detectSuppliedMIMEType({
        kind: 'http',
        contentType: value,
      }).checkForApacheBug).toBe(false);
    }
  });

  it('leaves the supplied type undefined without a valid final value', () => {
    expect(detectSuppliedMIMEType(
      { kind: 'http', contentType: undefined },
    ).suppliedMIMEType).toBeUndefined();

    expect(detectSuppliedMIMEType({
      kind: 'http',
      contentType: 'not a MIME type',
    }).suppliedMIMEType).toBeUndefined();
  });

  it('accepts a MIME type determined by the resource owner', () => {
    const mimeType = requiredMIMEType('application/example');

    expect(detectSuppliedMIMEType(
      { kind: 'mime-type', mimeType },
    )).toEqual({ suppliedMIMEType: mimeType, checkForApacheBug: false });
    expect(detectSuppliedMIMEType(
      { kind: 'mime-type', mimeType: undefined },
    )).toEqual({ suppliedMIMEType: undefined, checkForApacheBug: false });
  });
});

function requiredMIMEType(input: string): MIMEType {
  const mimeType = parseMIMEType(input);
  if (mimeType === null) throw new Error(`Expected a MIME type: ${input}`);
  return mimeType;
}
