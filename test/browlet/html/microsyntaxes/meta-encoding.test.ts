import { describe, expect, it } from 'vitest';
import { extractMetaEncoding } from '../../../../src/browlet/html/microsyntaxes/meta-encoding';

describe('HTML meta encoding extraction', () => {
  it.each([
    ['text/html; charset=UTF-8', 'UTF-8'],
    ['text/html; ChArSeT \t\n\f\r = \t ISO-8859-1 ; other=value', 'windows-1252'],
    ["charset='utf-8'", 'UTF-8'],
    ['charset=" windows-1252 "', 'windows-1252'],
    ['charset charset=Shift_JIS', 'Shift_JIS'],
    ['charsetcharset=utf-8', 'UTF-8'],
    ['xcharset=utf-8', 'UTF-8'],
    ['charset=windows-1252; charset=utf-8', 'windows-1252'],
    ['charset=utf-16', 'UTF-16LE'],
    ['charset=x-user-defined', 'x-user-defined'],
    ['', null],
    ['text/html', null],
    ['charset', null],
    ['charset = ', null],
    ['charset="utf-8', null],
    ["charset='utf-8", null],
    ['charset=""; charset=utf-8', null],
    ['charset=unknown; charset=utf-8', null],
    ['charset=; charset=utf-8', null],
    ['charset="utf\\-8"', null],
    ['charset\u00a0=utf-8', null],
    ['charset=\u000butf-8', null],
  ] as const)('extracts %j as %j', (input, expected) => {
    expect(extractMetaEncoding(input)).toBe(expected);
  });
});
