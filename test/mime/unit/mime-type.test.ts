import { describe, expect, it, vi } from 'vitest';

import {
  getMIMETypeEssence,
  isArchiveMIMEType,
  isAudioOrVideoMIMEType,
  isFontMIMEType,
  isHTMLMIMEType,
  isImageMIMEType,
  isJavaScriptMIMEType,
  isJavaScriptMIMETypeEssenceMatch,
  isJSONMIMEType,
  isScriptableMIMEType,
  isXMLMIMEType,
  isZIPBasedMIMEType,
  minimizeSupportedMIMEType,
  parseMIMEType,
  parseMIMETypeFromBytes,
  serializeMIMEType,
  serializeMIMETypeToBytes,
  type MIMEType,
} from '../../../src/mime';

/*
 * Focused cases derived from:
 *
 * https://github.com/web-platform-tests/wpt/blob/master/mimesniff/mime-types/resources/mime-types.json
 */
const parsingCases = [
  ['text/html;charset=gbk', 'text/html;charset=gbk'],
  ['TEXT/HTML;CHARSET=GBK', 'text/html;charset=GBK'],
  ['text/html;charset=gbk(', 'text/html;charset="gbk("'],
  ['text/html;x=(;charset=gbk', 'text/html;x="(";charset=gbk'],
  [
    'text/html;charset=gbk;charset=windows-1255',
    'text/html;charset=gbk',
  ],
  ['text/html;charset=();charset=GBK', 'text/html;charset="()"'],
  ['text/html;charset =gbk', 'text/html'],
  ['text/html ;charset=gbk', 'text/html;charset=gbk'],
  ['text/html; charset=gbk', 'text/html;charset=gbk'],
  ['text/html;charset= gbk', 'text/html;charset=" gbk"'],
  ['text/html;charset= "gbk"', 'text/html;charset=" \\"gbk\\""'],
  ['text/html;charset=\vgbk', 'text/html'],
  ['text/html;charset=\fgbk', 'text/html'],
  ['text/html;charset=\'gbk\'', 'text/html;charset=\'gbk\''],
  ['text/html;test;charset=gbk', 'text/html;charset=gbk'],
  ['text/html;test=;charset=gbk', 'text/html;charset=gbk'],
  ['text/html;;;;charset=gbk', 'text/html;charset=gbk'],
  ['text/html;charset="gbk"', 'text/html;charset=gbk'],
  ['text/html;charset="gbk', 'text/html;charset=gbk'],
  ['text/html;charset=gbk"', 'text/html;charset="gbk\\""'],
  ['text/html;charset="\\g\\b\\k"', 'text/html;charset=gbk'],
  ['text/html;charset="gbk"x', 'text/html;charset=gbk'],
  ['text/html;charset="";charset=GBK', 'text/html;charset=""'],
  ['text/html;charset={gbk}', 'text/html;charset="{gbk}"'],
  ['text/html;a]=bar;b[=bar;c=bar', 'text/html;c=bar'],
  ['text/html;valid=";";foo=bar', 'text/html;valid=";";foo=bar'],
  ['x/x;test', 'x/x'],
  ['x/x;test="\\', 'x/x;test="\\\\"'],
  ['x/x;x= ', 'x/x'],
  ['x/x\n\r\t ;x=x', 'x/x;x=x'],
  ['\n\r\t x/x;x=x\n\r\t ', 'x/x;x=x'],
  ['text/html;test=ÿ;charset=gbk', 'text/html;test="ÿ";charset=gbk'],
  ['x/x;test=�;x=x', 'x/x;x=x'],
] as const satisfies readonly (readonly [input: string, output: string])[];

const failureCases = [
  '\vx/x',
  '\fx/x',
  'x/x\v',
  'x/x\f',
  '',
  '\t',
  '/',
  'bogus',
  'bogus/',
  'bogus/ ',
  'bogus/bogus/;',
  '</>',
  '(/)',
  'ÿ/ÿ',
  'text/html(;doesnot=matter',
  '{/}',
  'Ā/Ā',
  'text /html',
  'text/ html',
  '"text/html"',
] as const;

describe('MIME Sniffing §4.4: parsing a MIME type', () => {
  for (const [input, output] of parsingCases) {
    it(`parses and normalizes ${JSON.stringify(input)}`, () => {
      const mimeType = parseMIMEType(input);
      expect(mimeType).not.toBeNull();
      expect(serializeMIMEType(mimeType!)).toBe(output);
    });
  }

  for (const input of failureCases) {
    it(`returns failure for ${JSON.stringify(input)}`, () => {
      expect(parseMIMEType(input)).toBeNull();
    });
  }

  it('preserves the first occurrence and insertion order of parameters', () => {
    const mimeType = requiredMIMEType('text/plain;b=2;a=1;b=3');

    expect([...mimeType.parameters]).toEqual([
      ['b', '2'],
      ['a', '1'],
    ]);
    expect(serializeMIMEType(mimeType)).toBe('text/plain;b=2;a=1');
  });

  it('parses isomorphically decoded bytes', () => {
    const mimeType = parseMIMETypeFromBytes(Uint8Array.of(
      0x54, 0x45, 0x58, 0x54, 0x2f, 0x58, 0x3b,
      0x6e, 0x61, 0x6d, 0x65, 0x3d, 0xff,
    ));

    expect(mimeType).not.toBeNull();
    expect(serializeMIMEType(mimeType!)).toBe('text/x;name="ÿ"');
  });
});

describe('MIME Sniffing §4.5: serializing a MIME type', () => {
  it('quotes empty and non-token values and escapes quotes and backslashes', () => {
    const mimeType: MIMEType = {
      type: 'text',
      subtype: 'plain',
      parameters: new Map([
        ['empty', ''],
        ['token', "!#$%&'*+-.^_`|~AZaz09"],
        ['quoted', 'a "quote" and \\'],
      ]),
    };

    expect(serializeMIMEType(mimeType)).toBe(
      'text/plain;empty="";token=!#$%&\'*+-.^_`|~AZaz09;' +
      'quoted="a \\"quote\\" and \\\\"',
    );
  });

  it('isomorphically encodes the serialization', () => {
    const bytes = serializeMIMETypeToBytes({
      type: 'text',
      subtype: 'x',
      parameters: new Map([['name', 'ÿ']]),
    });

    expect([...bytes]).toEqual([
      0x74, 0x65, 0x78, 0x74, 0x2f, 0x78, 0x3b,
      0x6e, 0x61, 0x6d, 0x65, 0x3d, 0x22, 0xff, 0x22,
    ]);
  });
});

describe('MIME Sniffing §§4.1–4.2 and §4.6: MIME classification', () => {
  it('computes the MIME type essence', () => {
    expect(getMIMETypeEssence(requiredMIMEType('text/html;charset=utf-8')))
      .toBe('text/html');
  });

  const groupCases = [
    ['image/x', [isImageMIMEType]],
    ['audio/x', [isAudioOrVideoMIMEType]],
    ['video/x', [isAudioOrVideoMIMEType]],
    ['application/ogg', [isAudioOrVideoMIMEType]],
    ['font/x', [isFontMIMEType]],
    ['application/font-otf', [isFontMIMEType]],
    ['application/font-woff', [isFontMIMEType]],
    ['x/x+zip', [isZIPBasedMIMEType]],
    ['application/zip', [isZIPBasedMIMEType, isArchiveMIMEType]],
    ['application/x-gzip', [isArchiveMIMEType]],
    ['application/xml', [isXMLMIMEType, isScriptableMIMEType]],
    ['x/x+xml', [isXMLMIMEType, isScriptableMIMEType]],
    ['text/html', [isHTMLMIMEType, isScriptableMIMEType]],
    ['application/pdf', [isScriptableMIMEType]],
    ['text/javascript', [isJavaScriptMIMEType]],
    ['x/x+json', [isJSONMIMEType]],
    ['text/json', [isJSONMIMEType]],
  ] as const;

  for (const [input, predicates] of groupCases) {
    it(`classifies ${input}`, () => {
      const mimeType = requiredMIMEType(input);
      for (const predicate of predicates) expect(predicate(mimeType)).toBe(true);
    });
  }

  it('uses the specified OTF font essence rather than the WPT fixture typo', () => {
    // mime-groups.json currently spells application/font-otf as font-off.
    expect(isFontMIMEType(requiredMIMEType('application/font-off'))).toBe(false);
  });

  it('does not classify parameter values as MIME type structure', () => {
    const mimeType = requiredMIMEType('x/x;type=image;subtype=x+json');

    expect(isImageMIMEType(mimeType)).toBe(false);
    expect(isJSONMIMEType(mimeType)).toBe(false);
  });

  it('matches JavaScript essences ASCII case-insensitively', () => {
    expect(isJavaScriptMIMETypeEssenceMatch('TEXT/JAVASCRIPT')).toBe(true);
    expect(isJavaScriptMIMETypeEssenceMatch('text/javascript;charset=utf-8'))
      .toBe(false);
  });
});

describe('MIME Sniffing §4.2: minimizing a supported MIME type', () => {
  for (const [input, output] of [
    ['application/ecmascript', 'text/javascript'],
    ['application/ld+json', 'application/json'],
    ['image/svg+xml', 'image/svg+xml'],
    ['application/xhtml+xml', 'application/xml'],
  ] as const) {
    it(`minimizes ${input} to ${output} without consulting host support`, () => {
      const supports = vi.fn(() => false);

      expect(minimizeSupportedMIMEType(requiredMIMEType(input), supports))
        .toBe(output);
      expect(supports).not.toHaveBeenCalled();
    });
  }

  it('returns a host-supported essence', () => {
    expect(minimizeSupportedMIMEType(
      requiredMIMEType('image/png;charset=ignored'),
      (mimeType) => getMIMETypeEssence(mimeType) === 'image/png',
    )).toBe('image/png');
  });

  it('returns the empty string for an unsupported type', () => {
    expect(minimizeSupportedMIMEType(
      requiredMIMEType('application/x-unknown'),
      () => false,
    )).toBe('');
  });
});

function requiredMIMEType(input: string): MIMEType {
  const mimeType = parseMIMEType(input);
  if (mimeType === null) throw new Error(`Expected a MIME type: ${input}`);
  return mimeType;
}
