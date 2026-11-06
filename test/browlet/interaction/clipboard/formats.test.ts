import { describe, expect, it } from 'vitest';

import {
  getCustomFormatMapName, getCustomFormatName, getWellKnownFormat, getWellKnownMIMEType,
  type ClipboardFormat, type ClipboardPlatform,
} from '../../../../src/browlet/interaction/clipboard/index';
import { getMIMETypeEssence } from '../../../../src/mime/index';

const platforms: ClipboardPlatform[] = ['windows', 'macos', 'linux', 'chromeos', 'android'];
const standardTypes = ['text/plain', 'text/html', 'image/png', 'image/svg+xml'];
const expectedFormats: Record<ClipboardPlatform, ClipboardFormat[]> = {
  windows: [13, 'HTML Format', 'PNG', 'image/svg+xml'],
  macos: ['public.utf8-plain-text', 'public.html', 'public.png', 'public.svg-image'],
  linux: [...standardTypes], chromeos: [...standardTypes], android: [...standardTypes],
};

describe.each(platforms)('Clipboard Appendix A.3/A.4: %s', (platform) => {
  it.each(standardTypes)('maps %s to the specified OS identifier and back', (type) => {
    const format = expectedFormats[platform][standardTypes.indexOf(type)]!;
    expect(getWellKnownFormat(type, platform)).toBe(format);
    const mime = getWellKnownMIMEType(format, platform)!;
    expect(getMIMETypeEssence(mime)).toBe(type);
    expect(mime.parameters.size).toBe(0);
  });

  it('uses MIME essence, including parameterized writeText data', () => {
    expect(getWellKnownFormat('text/plain;charset=utf-8', platform)).toBe(expectedFormats[platform][0]);
    expect(getWellKnownFormat(' TEXT/HTML ; charset="utf-8" ', platform)).toBe(expectedFormats[platform][1]);
    expect(getWellKnownFormat('image/SVG+xml;profile="tiny"', platform)).toBe(expectedFormats[platform][3]);
  });

  it('does not invent standard mappings for invalid, optional or custom types', () => {
    for (const type of ['', 'invalid', 'text/plain/extra', 'text/uri-list', 'application/xhtml+xml',
      'application/x-browlet', 'web text/plain', 'web image/png']) {
      expect(getWellKnownFormat(type, platform)).toBe('');
    }
    for (const format of ['', 0, 49152, 'unknown', 'text/plain;charset=utf-8',
      getCustomFormatMapName(platform), getCustomFormatName(0, platform)]) {
      expect(getWellKnownMIMEType(format, platform)).toBeNull();
    }
  });

  it('does not share mutable MIME records between translations', () => {
    const format = expectedFormats[platform][0]!;
    const first = getWellKnownMIMEType(format, platform)!;
    first.type = 'changed'; first.parameters.set('charset', 'utf-16');
    const second = getWellKnownMIMEType(format, platform)!;
    expect(second).not.toBe(first);
    expect(getMIMETypeEssence(second)).toBe('text/plain');
    expect(second.parameters.size).toBe(0);
  });
});

describe('Clipboard format representation', () => {
  it('distinguishes Windows predefined text from a registered name or numeric string', () => {
    expect(getWellKnownFormat('text/plain', 'windows')).toBe(13);
    expect(getWellKnownMIMEType('13', 'windows')).toBeNull();
    expect(getWellKnownMIMEType('UnicodeText', 'windows')).toBeNull();
    expect(getWellKnownMIMEType(13, 'macos')).toBeNull();
    expect(getWellKnownMIMEType(13, 'linux')).toBeNull();
  });

  it('requires the selected platform rather than inferring it from a format', () => {
    expect(getWellKnownMIMEType('HTML Format', 'linux')).toBeNull();
    expect(getWellKnownMIMEType('public.html', 'windows')).toBeNull();
    expect(getWellKnownMIMEType('text/html', 'macos')).toBeNull();
  });
});

describe('Clipboard Appendix A.7/A.8: web custom format names', () => {
  it.each([
    ['windows', 'Web Custom Format Map', 'Web Custom Format0', 'Web Custom Format100'],
    ['macos', 'org.w3.web-custom-format.map', 'org.w3.web-custom-format.type-0', 'org.w3.web-custom-format.type-100'],
    ['linux', 'application/web;type="custom/formatmap"', 'application/web;type="custom/format0"', 'application/web;type="custom/format100"'],
    ['chromeos', 'application/web;type="custom/formatmap"', 'application/web;type="custom/format0"', 'application/web;type="custom/format100"'],
    ['android', 'application/web;type="custom/formatmap"', 'application/web;type="custom/format0"', 'application/web;type="custom/format100"'],
  ] as const)('uses complete map and indexed names on %s', (platform, map, first, last) => {
    expect(getCustomFormatMapName(platform)).toBe(map);
    expect(getCustomFormatName(0, platform)).toBe(first);
    expect(getCustomFormatName(100, platform)).toBe(last);
    expect(getCustomFormatName(1, platform)).not.toBe(first);
    expect(getCustomFormatName(0, platform)).not.toBe(map);
  });
});
