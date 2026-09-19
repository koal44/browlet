import { describe, expect, it, vi } from 'vitest';

import { getMIMETypeEssence, parseMIMEType, type MIMEType } from '../../src/mime/mime-type';
import { type SuppliedMIMETypeDetection } from '../../src/mime/resource';
import {
  distinguishTextOrBinary, identifyUnknownMIMEType, sniffMIMEType,
  sniffMIMETypeInAudioOrVideoContext, sniffMIMETypeInBrowsingContext,
  sniffMIMETypeInCacheManifestContext, sniffMIMETypeInFontContext,
  sniffMIMETypeInImageContext, sniffMIMETypeInPluginContext,
  sniffMIMETypeInScriptContext, sniffMIMETypeInStyleContext,
  sniffMIMETypeInTextTrackContext,
} from '../../src/mime/sniffing';

describe('MIME Sniffing §7.1: identifying an unknown MIME type', () => {
  const scriptableCases: [string, string][] = [
    ['  <!doctype html>', 'text/html'],
    ['\t<html ', 'text/html'],
    ['\n<head>', 'text/html'],
    ['\r<script>', 'text/html'],
    ['\f<iframe>', 'text/html'],
    [' <h1>', 'text/html'],
    [' <div>', 'text/html'],
    [' <font>', 'text/html'],
    [' <table>', 'text/html'],
    [' <a>', 'text/html'],
    [' <style>', 'text/html'],
    [' <title>', 'text/html'],
    [' <b>', 'text/html'],
    [' <body>', 'text/html'],
    [' <br>', 'text/html'],
    [' <p>', 'text/html'],
    [' <!-->', 'text/html'],
    [' <?xml', 'text/xml'],
    ['%PDF-', 'application/pdf'],
  ];

  for (const [input, expected] of scriptableCases) {
    it(`recognizes the scriptable ${expected} signature`, () => {
      expect(essence(identifyUnknownMIMEType(ascii(input), true)))
        .toBe(expected);
    });
  }

  it('requires an exact HTML tag-terminating byte', () => {
    for (const input of ['<html', '<html\t', '<htmlx']) {
      expect(essence(identifyUnknownMIMEType(ascii(input), true)))
        .toBe('text/plain');
    }
    for (const input of ['<html ', '<html>']) {
      expect(essence(identifyUnknownMIMEType(ascii(input), true)))
        .toBe('text/html');
    }
  });

  it('honors the scriptable flag', () => {
    expect(essence(identifyUnknownMIMEType(ascii('<html>'), false)))
      .toBe('text/plain');
    expect(essence(identifyUnknownMIMEType(ascii('%PDF-'), false)))
      .toBe('text/plain');
  });

  it('recognizes safe signatures before format signatures', () => {
    expect(essence(identifyUnknownMIMEType(ascii('%!PS-Adobe-'))))
      .toBe('application/postscript');
    expect(essence(identifyUnknownMIMEType(bytes(0xfe, 0xff, 1, 2))))
      .toBe('text/plain');
    expect(essence(identifyUnknownMIMEType(bytes(0xff, 0xfe, 1, 2))))
      .toBe('text/plain');
    expect(essence(identifyUnknownMIMEType(bytes(0xef, 0xbb, 0xbf, 1))))
      .toBe('text/plain');
    expect(essence(identifyUnknownMIMEType(bytes(0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a))))
      .toBe('image/png');
    expect(essence(identifyUnknownMIMEType(ascii('fLaC'))))
      .toBe('audio/flac');
    expect(essence(identifyUnknownMIMEType(bytes(0x50, 0x4b, 0x03, 0x04))))
      .toBe('application/zip');
  });

  it('falls back according to the binary-data-byte ranges', () => {
    expect(essence(identifyUnknownMIMEType(ascii('ordinary text'))))
      .toBe('text/plain');

    for (const byte of [0x00, 0x08, 0x0b, 0x0e, 0x1a, 0x1c, 0x1f]) {
      expect(essence(identifyUnknownMIMEType(bytes(0x41, byte, 0x42))))
        .toBe('application/octet-stream');
    }
    for (const byte of [0x09, 0x0a, 0x0c, 0x0d, 0x1b, 0x20]) {
      expect(essence(identifyUnknownMIMEType(bytes(0x41, byte, 0x42))))
        .toBe('text/plain');
    }
  });
});

describe('MIME Sniffing §7.2: distinguishing text or binary', () => {
  it('preserves text BOMs and ordinary text', () => {
    for (const header of [
      bytes(0xfe, 0xff, 0x00),
      bytes(0xff, 0xfe, 0x00),
      bytes(0xef, 0xbb, 0xbf, 0x00),
      ascii('text'),
    ]) {
      expect(essence(distinguishTextOrBinary(header))).toBe('text/plain');
    }
  });

  it('classifies other binary data as application/octet-stream', () => {
    expect(essence(distinguishTextOrBinary(bytes(0x41, 0x00, 0x42))))
      .toBe('application/octet-stream');
  });
});

describe('MIME Sniffing §7: computed MIME types', () => {
  const supported = () => true;

  it('preserves supplied XML and HTML before every sniffing flag', () => {
    for (const supplied of ['text/html', 'application/example+xml']) {
      expect(essence(sniffMIMEType(
        detection(supplied, true),
        bytes(0x00),
        true,
        supported,
      ))).toBe(supplied);
    }
  });

  it('identifies each spelling of an unknown supplied type', () => {
    for (const supplied of [undefined, 'unknown/unknown', 'application/unknown', '*/*']) {
      expect(essence(sniffMIMEType(
        detection(supplied),
        ascii('<html>'),
        false,
        supported,
      ))).toBe('text/html');
    }
  });

  it('uses no-sniff to suppress only scriptable unknown-type matching', () => {
    expect(essence(sniffMIMEType(
      detection(undefined),
      ascii('<html>'),
      true,
      supported,
    ))).toBe('text/plain');

    expect(essence(sniffMIMEType(
      detection(undefined),
      ascii('GIF89a'),
      true,
      supported,
    ))).toBe('image/gif');
  });

  it('preserves known types when no-sniff is set', () => {
    expect(essence(sniffMIMEType(
      detection('image/png'),
      ascii('GIF89a'),
      true,
      supported,
    ))).toBe('image/png');
  });

  it('applies the Apache-bug text-or-binary rule without privileged sniffing', () => {
    const supplied = detection('text/plain', true);
    expect(essence(sniffMIMEType(
      supplied,
      ascii('<html>'),
      false,
      supported,
    ))).toBe('text/plain');

    expect(essence(sniffMIMEType(
      supplied,
      bytes(0x00),
      false,
      supported,
    )))
      .toBe('application/octet-stream');
  });

  it('sniffs supported image and media types and preserves unsupported ones', () => {
    expect(essence(sniffMIMEType(
      detection('image/example'),
      ascii('GIF89a'),
      false,
      supported,
    ))).toBe('image/gif');

    expect(essence(sniffMIMEType(
      detection('audio/example'),
      ascii('fLaC'),
      false,
      supported,
    ))).toBe('audio/flac');

    const isSupported = vi.fn(() => false);
    const unsupported = detection('image/example');
    expect(essence(sniffMIMEType(
      unsupported,
      ascii('GIF89a'),
      false,
      isSupported,
    )))
      .toBe('image/example');
    expect(isSupported).toHaveBeenCalledWith(unsupported.suppliedMIMEType);
  });
});

describe('MIME Sniffing §8: context-specific sniffing', () => {
  it('uses the general algorithm in a browsing context', () => {
    expect(essence(sniffMIMETypeInBrowsingContext(
      detection(undefined),
      ascii('<html>'),
      false,
      () => true,
    )))
      .toBe('text/html');
  });

  it('sniffs image, audio/video, and font contexts', () => {
    const cases = [
      [sniffMIMETypeInImageContext, 'image/example', ascii('GIF89a'), 'image/gif'],
      [sniffMIMETypeInAudioOrVideoContext, 'audio/example', ascii('fLaC'), 'audio/flac'],
      [sniffMIMETypeInFontContext, 'font/example', ascii('wOFF'), 'font/woff'],
    ] as const;

    for (const [sniff, supplied, header, expected] of cases) {
      expect(essence(sniff(requiredMIMEType(supplied), header))).toBe(expected);
    }
  });

  it('preserves XML and unmatched supplied types in pattern contexts', () => {
    const xml = requiredMIMEType('image/example+xml');
    expect(sniffMIMETypeInImageContext(xml, ascii('GIF89a'))).toBe(xml);

    const unmatched = requiredMIMEType('audio/example');
    expect(sniffMIMETypeInAudioOrVideoContext(unmatched, ascii('not audio')))
      .toBe(unmatched);
  });

  it('defaults a missing plugin type to application/octet-stream', () => {
    expect(essence(sniffMIMETypeInPluginContext(undefined)))
      .toBe('application/octet-stream');

    const supplied = requiredMIMEType('application/example');
    expect(sniffMIMETypeInPluginContext(supplied)).toBe(supplied);
  });

  it('delegates only unfinished missing style and script types', () => {
    const resolve = vi.fn((context: 'style' | 'script') =>
      requiredMIMEType(context === 'style' ? 'text/css' : 'text/javascript')
    );

    expect(essence(sniffMIMETypeInStyleContext(undefined, resolve)))
      .toBe('text/css');

    expect(essence(sniffMIMETypeInScriptContext(undefined, resolve)))
      .toBe('text/javascript');

    const supplied = requiredMIMEType('application/example');
    expect(sniffMIMETypeInScriptContext(supplied, resolve))
      .toBe(supplied);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('sets the fixed text-track and cache-manifest types', () => {
    expect(essence(sniffMIMETypeInTextTrackContext()))
      .toBe('text/vtt');

    expect(essence(sniffMIMETypeInCacheManifestContext()))
      .toBe('text/cache-manifest');
  });
});

function detection(
  supplied: string | undefined,
  checkForApacheBug = false,
): SuppliedMIMETypeDetection {
  return {
    suppliedMIMEType: supplied === undefined ? undefined : requiredMIMEType(supplied),
    checkForApacheBug,
  };
}

function essence(mimeType: MIMEType | undefined): string | undefined {
  return mimeType === undefined ? undefined : getMIMETypeEssence(mimeType);
}

function requiredMIMEType(input: string): MIMEType {
  const mimeType = parseMIMEType(input);
  if (mimeType === null) throw new Error(`Expected a MIME type: ${input}`);
  return mimeType;
}

function ascii(input: string): Uint8Array {
  return Uint8Array.from(input, (character) => character.charCodeAt(0));
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.of(...values);
}
