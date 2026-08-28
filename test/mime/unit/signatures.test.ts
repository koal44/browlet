import { describe, expect, it } from 'vitest';

import {
  getMIMETypeEssence,
  matchArchiveTypePattern,
  matchAudioOrVideoTypePattern,
  matchFontTypePattern,
  matchImageTypePattern,
  matchesBytePattern,
  matchesMP3SignatureWithoutID3,
  matchesMP4Signature,
  matchesWebMSignature,
  type MIMEType,
} from '../../../src/mime';

describe('MIME Sniffing §6.1: matching a MIME type pattern', () => {
  it('matches exact and masked bytes', () => {
    expect(matchesBytePattern(
      bytes(0x48, 0x54, 0x4d, 0x4c),
      bytes(0x48, 0x54, 0x4d, 0x4c),
      bytes(0xff, 0xff, 0xff, 0xff),
      new Set(),
    )).toBe(true);

    expect(matchesBytePattern(
      bytes(0x68, 0x74, 0x6d, 0x6c),
      bytes(0x48, 0x54, 0x4d, 0x4c),
      bytes(0xdf, 0xdf, 0xdf, 0xdf),
      new Set(),
    )).toBe(true);
  });

  it('skips only the requested leading bytes', () => {
    const ignored = new Set([0x09, 0x0a, 0x0c, 0x0d, 0x20]);

    expect(matchesBytePattern(
      bytes(0x20, 0x09, 0x41, 0x42),
      bytes(0x41, 0x42),
      bytes(0xff, 0xff),
      ignored,
    )).toBe(true);
    expect(matchesBytePattern(
      bytes(0x20, 0x43, 0x41, 0x42),
      bytes(0x41, 0x42),
      bytes(0xff, 0xff),
      ignored,
    )).toBe(false);
  });

  it('rejects truncated input after ignored bytes', () => {
    expect(matchesBytePattern(
      bytes(0x20, 0x41),
      bytes(0x41, 0x42),
      bytes(0xff, 0xff),
      new Set([0x20]),
    )).toBe(false);
  });

  it('requires the pattern and mask to have equal lengths', () => {
    expect(() => matchesBytePattern(
      bytes(0x41),
      bytes(0x41),
      bytes(0xff, 0xff),
      new Set(),
    )).toThrow(RangeError);
  });
});

describe('MIME Sniffing §6.2: image signatures', () => {
  const cases = [
    [bytes(0x00, 0x00, 0x01, 0x00), 'image/x-icon'],
    [bytes(0x00, 0x00, 0x02, 0x00), 'image/x-icon'],
    [bytes(0x42, 0x4d), 'image/bmp'],
    [bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61), 'image/gif'],
    [bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61), 'image/gif'],
    [bytes(
      0x52, 0x49, 0x46, 0x46, 0x12, 0x34, 0x56,
      0x78, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
    ), 'image/webp'],
    [bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'image/png'],
    [bytes(0xff, 0xd8, 0xff), 'image/jpeg'],
  ] as [Uint8Array, string][];

  for (const [signature, expected] of cases) {
    it(`matches ${expected}`, () => {
      expect(essence(matchImageTypePattern(signature))).toBe(expected);
    });

    it(`rejects truncated and adjacent ${expected} signatures`, () => {
      expect(matchImageTypePattern(signature.slice(0, -1))).toBeUndefined();
      const adjacent = signature.slice();
      adjacent[adjacent.length - 1]! ^= 1;
      expect(matchImageTypePattern(adjacent)).toBeUndefined();
    });
  }
});

describe('MIME Sniffing §6.3: audio and video signatures', () => {
  const cases = [
    [bytes(
      0x46, 0x4f, 0x52, 0x4d, 1, 2, 3, 4, 0x41, 0x49, 0x46, 0x46,
    ), 'audio/aiff'],
    [bytes(0x49, 0x44, 0x33), 'audio/mpeg'],
    [bytes(0x4f, 0x67, 0x67, 0x53, 0x00), 'application/ogg'],
    [bytes(0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06), 'audio/midi'],
    [bytes(
      0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20,
    ), 'video/avi'],
    [bytes(
      0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45,
    ), 'audio/wave'],
    [bytes(0x66, 0x4c, 0x61, 0x43), 'audio/flac'],
  ] as [Uint8Array, string][];

  for (const [signature, expected] of cases) {
    it(`matches ${expected}`, () => {
      expect(essence(matchAudioOrVideoTypePattern(signature))).toBe(expected);
    });

    it(`rejects truncated and adjacent ${expected} signatures`, () => {
      expect(matchAudioOrVideoTypePattern(signature.slice(0, -1)))
        .toBeUndefined();
      const adjacent = signature.slice();
      adjacent[adjacent.length - 1]! ^= 1;
      expect(matchAudioOrVideoTypePattern(adjacent)).toBeUndefined();
    });
  }

  it('returns a fresh MIME record for each match', () => {
    const input = bytes(0x49, 0x44, 0x33);
    const first = matchAudioOrVideoTypePattern(input)!;
    first.parameters.set('changed', 'yes');

    expect(matchAudioOrVideoTypePattern(input)!.parameters.size).toBe(0);
  });

});

describe('MIME Sniffing §6.3.1: MP4 signatures', () => {
  it('matches an mp4 major brand', () => {
    expect(matchesMP4Signature(bytes(
      0x00, 0x00, 0x00, 0x0c,
      0x66, 0x74, 0x79, 0x70,
      0x6d, 0x70, 0x34, 0x32,
    ))).toBe(true);
  });

  it('matches an mp4 compatible brand', () => {
    const input = bytes(
      0x00, 0x00, 0x00, 0x1c,
      0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6f, 0x6d,
      0x00, 0x00, 0x02, 0x00,
      0x69, 0x73, 0x6f, 0x6d,
      0x69, 0x73, 0x6f, 0x32,
      0x6d, 0x70, 0x34, 0x31,
    );

    expect(matchesMP4Signature(input)).toBe(true);
    expect(essence(matchAudioOrVideoTypePattern(input))).toBe('video/mp4');
  });

  it('rejects invalid sizes, truncated boxes, and non-ftyp boxes', () => {
    expect(matchesMP4Signature(new Uint8Array(11))).toBe(false);
    expect(matchesMP4Signature(bytes(
      0x00, 0x00, 0x00, 0x0d,
      0x66, 0x74, 0x79, 0x70,
      0x6d, 0x70, 0x34, 0x32, 0x00,
    ))).toBe(false);
    expect(matchesMP4Signature(bytes(
      0x00, 0x00, 0x00, 0x10,
      0x66, 0x74, 0x79, 0x70,
      0x6d, 0x70, 0x34, 0x32,
    ))).toBe(false);
    expect(matchesMP4Signature(bytes(
      0x00, 0x00, 0x00, 0x0c,
      0x66, 0x72, 0x65, 0x65,
      0x6d, 0x70, 0x34, 0x32,
    ))).toBe(false);
  });
});

describe('MIME Sniffing §6.3.2: WebM signatures', () => {
  it('matches a WebM document type and its padded form', () => {
    const direct = bytes(
      0x1a, 0x45, 0xdf, 0xa3,
      0x42, 0x82, 0x84,
      0x77, 0x65, 0x62, 0x6d, 0x00,
    );
    const padded = bytes(
      0x1a, 0x45, 0xdf, 0xa3,
      0x42, 0x82, 0x86,
      0x00, 0x00, 0x77, 0x65, 0x62, 0x6d, 0x00,
    );
    const twoByteVint = bytes(
      0x1a, 0x45, 0xdf, 0xa3,
      0x42, 0x82, 0x40, 0x04,
      0x77, 0x65, 0x62, 0x6d, 0x00,
    );

    expect(matchesWebMSignature(direct)).toBe(true);
    expect(matchesWebMSignature(padded)).toBe(true);
    expect(matchesWebMSignature(twoByteVint)).toBe(true);
    expect(essence(matchAudioOrVideoTypePattern(direct))).toBe('video/webm');
  });

  it('handles truncated WebM candidates without reading past the input', () => {
    expect(matchesWebMSignature(bytes(0x1a, 0x45, 0xdf))).toBe(false);
    expect(matchesWebMSignature(bytes(
      0x1a, 0x45, 0xdf, 0xa3, 0x42,
    ))).toBe(false);
    expect(matchesWebMSignature(bytes(
      0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x80,
    ))).toBe(false);
    expect(matchesWebMSignature(bytes(
      0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x40,
    ))).toBe(false);
  });

  it('does not search for the document type beyond byte 37', () => {
    const input = new Uint8Array(50);
    input.set(bytes(0x1a, 0x45, 0xdf, 0xa3));
    input.set(bytes(0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d), 38);

    expect(matchesWebMSignature(input)).toBe(false);
  });
});

describe('MIME Sniffing §6.3.3: MP3 signatures without ID3', () => {
  it('requires two valid MPEG Layer III headers at the computed boundary', () => {
    const input = new Uint8Array(212);
    input.set(bytes(0xff, 0xfb, 0x50, 0xc4));
    input.set(bytes(0xff, 0xfb, 0x50, 0xc4), 208);

    expect(matchesMP3SignatureWithoutID3(input)).toBe(true);
    expect(essence(matchAudioOrVideoTypePattern(input))).toBe('audio/mpeg');

    input[208] = 0;
    expect(matchesMP3SignatureWithoutID3(input)).toBe(false);
  });

  it('rejects invalid sync, layer, bitrate, and sample-rate fields', () => {
    for (const header of [
      bytes(0xfe, 0xfb, 0x50, 0xc4),
      bytes(0xff, 0xf9, 0x50, 0xc4),
      bytes(0xff, 0xfb, 0xf0, 0xc4),
      bytes(0xff, 0xfb, 0x5c, 0xc4),
    ]) {
      expect(matchesMP3SignatureWithoutID3(header)).toBe(false);
    }
  });
});

describe('MIME Sniffing §§6.4–6.5: font and archive signatures', () => {
  const cases = [
    [matchFontTypePattern, bytes(
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
      19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
      0x4c, 0x50,
    ), 'application/vnd.ms-fontobject'],
    [matchFontTypePattern, bytes(0x00, 0x01, 0x00, 0x00), 'font/ttf'],
    [matchFontTypePattern, bytes(0x4f, 0x54, 0x54, 0x4f), 'font/otf'],
    [matchFontTypePattern, bytes(0x74, 0x74, 0x63, 0x66), 'font/collection'],
    [matchFontTypePattern, bytes(0x77, 0x4f, 0x46, 0x46), 'font/woff'],
    [matchFontTypePattern, bytes(0x77, 0x4f, 0x46, 0x32), 'font/woff2'],
    [matchArchiveTypePattern, bytes(0x1f, 0x8b, 0x08), 'application/x-gzip'],
    [matchArchiveTypePattern, bytes(0x50, 0x4b, 0x03, 0x04), 'application/zip'],
    [matchArchiveTypePattern,
      bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00),
      'application/x-rar-compressed'],
  ] as [(input: Uint8Array) => MIMEType | undefined, Uint8Array, string][];

  for (const [match, signature, expected] of cases) {
    it(`matches ${expected}`, () => {
      expect(essence(match(signature))).toBe(expected);
    });

    it(`rejects truncated and adjacent ${expected} signatures`, () => {
      expect(match(signature.slice(0, -1))).toBeUndefined();
      const adjacent = signature.slice();
      adjacent[adjacent.length - 1]! ^= 1;
      expect(match(adjacent)).toBeUndefined();
    });
  }
});

function essence(mimeType: MIMEType | undefined): string | undefined {
  return mimeType === undefined ? undefined : getMIMETypeEssence(mimeType);
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.of(...values);
}
