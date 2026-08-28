import { describe, expect, it, vi } from 'vitest';

import {
  createResourceMetadata,
  distinguishTextOrBinary,
  getMIMETypeEssence,
  identifyUnknownMIMEType,
  parseMIMEType,
  sniffMIMEType,
  sniffMIMETypeInAudioOrVideoContext,
  sniffMIMETypeInBrowsingContext,
  sniffMIMETypeInCacheManifestContext,
  sniffMIMETypeInFontContext,
  sniffMIMETypeInImageContext,
  sniffMIMETypeInPluginContext,
  sniffMIMETypeInScriptContext,
  sniffMIMETypeInStyleContext,
  sniffMIMETypeInTextTrackContext,
  type MIMEType,
  type ResourceMetadata,
} from '../../../src/mime';

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

  it('requires HTML tag termination and honors the scriptable flag', () => {
    expect(essence(identifyUnknownMIMEType(ascii('<htmlx'), true)))
      .toBe('text/plain');
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
      const resource = metadata(supplied, bytes(0x00), {
        noSniff: true,
        apache: true,
      });

      expect(essence(sniffMIMEType(resource, supported))).toBe(supplied);
      expect(resource.computedMIMEType).toBe(resource.suppliedMIMEType);
    }
  });

  it('does not require a header for an early supplied-type decision', () => {
    const html = createResourceMetadata({
      kind: 'other',
      mimeType: requiredMIMEType('text/html'),
    });
    expect(sniffMIMEType(html, supported)).toBe(html.suppliedMIMEType);

    const noSniff = createResourceMetadata(
      {
        kind: 'other',
        mimeType: requiredMIMEType('application/example'),
      },
      { noSniff: true },
    );
    expect(sniffMIMEType(noSniff, supported)).toBe(noSniff.suppliedMIMEType);
  });

  it('identifies each spelling of an unknown supplied type', () => {
    for (const supplied of [undefined, 'unknown/unknown', 'application/unknown', '*/*']) {
      const resource = metadata(supplied, ascii('<html>'));
      expect(essence(sniffMIMEType(resource, supported))).toBe('text/html');
    }
  });

  it('uses no-sniff to suppress scriptable unknown-type matching', () => {
    const resource = metadata(undefined, ascii('<html>'), { noSniff: true });
    expect(essence(sniffMIMEType(resource, supported))).toBe('text/plain');
  });

  it('preserves known types when no-sniff is set', () => {
    const resource = metadata('image/png', ascii('GIF89a'), { noSniff: true });
    expect(essence(sniffMIMEType(resource, supported))).toBe('image/png');
  });

  it('applies the Apache-bug text-or-binary rule without privileged sniffing', () => {
    const resource = metadata('text/plain', ascii('<html>'), { apache: true });
    expect(essence(sniffMIMEType(resource, supported))).toBe('text/plain');

    resource.resourceHeader = bytes(0x00);
    expect(essence(sniffMIMEType(resource, supported)))
      .toBe('application/octet-stream');
  });

  it('sniffs supported image and media types and preserves unsupported ones', () => {
    const image = metadata('image/example', ascii('GIF89a'));
    expect(essence(sniffMIMEType(image, supported))).toBe('image/gif');

    const audio = metadata('audio/example', ascii('fLaC'));
    expect(essence(sniffMIMEType(audio, supported))).toBe('audio/flac');

    const isSupported = vi.fn(() => false);
    const unsupported = metadata('image/example', ascii('GIF89a'));
    expect(essence(sniffMIMEType(unsupported, isSupported)))
      .toBe('image/example');
    expect(isSupported).toHaveBeenCalledWith(unsupported.suppliedMIMEType);
  });

  it('requires the resource-header lifecycle before sniffing', () => {
    const resource = createResourceMetadata({
      kind: 'other',
      mimeType: requiredMIMEType('text/plain'),
    });
    expect(() => sniffMIMEType(resource, supported)).toThrow(
      'The resource header must be read before MIME sniffing',
    );
  });
});

describe('MIME Sniffing §8: context-specific sniffing', () => {
  it('uses the general algorithm in a browsing context', () => {
    const resource = metadata(undefined, ascii('<html>'));
    expect(essence(sniffMIMETypeInBrowsingContext(resource, () => true)))
      .toBe('text/html');
  });

  it('sniffs image, audio/video, and font contexts', () => {
    const cases = [
      [sniffMIMETypeInImageContext, 'image/example', ascii('GIF89a'), 'image/gif'],
      [sniffMIMETypeInAudioOrVideoContext, 'audio/example', ascii('fLaC'), 'audio/flac'],
      [sniffMIMETypeInFontContext, 'font/example', ascii('wOFF'), 'font/woff'],
    ] as const;

    for (const [sniff, supplied, header, expected] of cases) {
      const resource = metadata(supplied, header);
      expect(essence(sniff(resource))).toBe(expected);
      expect(essence(resource.computedMIMEType)).toBe(expected);
    }
  });

  it('preserves XML and unmatched supplied types in pattern contexts', () => {
    const xml = metadata('image/example+xml', ascii('GIF89a'));
    expect(sniffMIMETypeInImageContext(xml)).toBe(xml.suppliedMIMEType);

    const unmatched = metadata('audio/example', ascii('not audio'));
    expect(sniffMIMETypeInAudioOrVideoContext(unmatched))
      .toBe(unmatched.suppliedMIMEType);
  });

  it('defaults a missing plugin type to application/octet-stream', () => {
    const missing = metadata(undefined, new Uint8Array());
    expect(essence(sniffMIMETypeInPluginContext(missing)))
      .toBe('application/octet-stream');

    const supplied = metadata('application/example', new Uint8Array());
    expect(sniffMIMETypeInPluginContext(supplied)).toBe(supplied.suppliedMIMEType);
  });

  it('delegates only unfinished missing style and script types', () => {
    const resolve = vi.fn((context: 'style' | 'script') =>
      requiredMIMEType(context === 'style' ? 'text/css' : 'text/javascript')
    );

    const style = metadata(undefined, new Uint8Array());
    expect(essence(sniffMIMETypeInStyleContext(style, resolve))).toBe('text/css');

    const script = metadata(undefined, new Uint8Array());
    expect(essence(sniffMIMETypeInScriptContext(script, resolve)))
      .toBe('text/javascript');

    const supplied = metadata('application/example', new Uint8Array());
    expect(sniffMIMETypeInScriptContext(supplied, resolve))
      .toBe(supplied.suppliedMIMEType);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('sets the fixed text-track and cache-manifest types', () => {
    const textTrack = metadata('application/example', new Uint8Array());
    expect(essence(sniffMIMETypeInTextTrackContext(textTrack)))
      .toBe('text/vtt');

    const manifest = metadata(undefined, new Uint8Array());
    expect(essence(sniffMIMETypeInCacheManifestContext(manifest)))
      .toBe('text/cache-manifest');
  });
});

function metadata(
  supplied: string | undefined,
  header: Uint8Array,
  options: { noSniff?: boolean; apache?: boolean; } = {},
): ResourceMetadata {
  const resource = createResourceMetadata(
    {
      kind: 'other',
      mimeType: supplied === undefined ? undefined : requiredMIMEType(supplied),
    },
    { noSniff: options.noSniff },
  );
  resource.checkForApacheBug = options.apache ?? false;
  resource.resourceHeader = header;
  return resource;
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
