import { getMIMETypeEssence, parseMIMEType, type MIMEType } from '../../../mime/index';

/** Translate Blob.type to a standard OS format; the empty string means no mapping. */
// https://w3c.github.io/clipboard-apis/#to-os-specific-well-known-format
// The adapter supplies the platform explicitly; this operation does not register or access formats.
export function getWellKnownFormat(type: string, platform: ClipboardPlatform): ClipboardFormat {
  const mimeType = parseMIMEType(type);
  if (mimeType === null) return '';
  const formats = wellKnownFormats[platform];
  switch (getMIMETypeEssence(mimeType)) {
    case 'text/plain': return formats.text;
    case 'text/html': return formats.html;
    case 'image/png': return formats.png;
    case 'image/svg+xml': return formats.svg;
    default: return '';
  }
}

/** Translate a standard OS format to a fresh MIME record; unrecognized formats return null. */
// https://w3c.github.io/clipboard-apis/#to-well-known-mime-type-from-os-specific-format
export function getWellKnownMIMEType(format: ClipboardFormat, platform: ClipboardPlatform): MIMEType | null {
  const formats = wellKnownFormats[platform];
  // SPEC_CLASH(clipboard-windows-text-format): A.4 calls Windows text "UnicodeText",
  // while A.3 and Windows/Blink use CF_UNICODETEXT. Keep its predefined numeric ID.
  switch (format) {
    case formats.text: return parseMIMEType('text/plain');
    case formats.html: return parseMIMEType('text/html');
    case formats.png: return parseMIMEType('image/png');
    case formats.svg: return parseMIMEType('image/svg+xml');
    default: return null;
  }
}

/** Name of the OS format containing the JSON map of web custom representations. */
// https://w3c.github.io/clipboard-apis/#to-os-specific-custom-map-name
export function getCustomFormatMapName(platform: ClipboardPlatform): string {
  switch (platform) {
    case 'windows': return 'Web Custom Format Map';
    case 'macos': return 'org.w3.web-custom-format.map';
    case 'linux': case 'chromeos': case 'android': return 'application/web;type="custom/formatmap"';
  }
}

/** Complete OS format name for a zero-based custom representation index. */
// https://w3c.github.io/clipboard-apis/#to-os-specific-custom-name
// A.6 supplies the index. Construct the complete name here instead of returning A.8's prefix.
export function getCustomFormatName(index: number, platform: ClipboardPlatform): string {
  switch (platform) {
    case 'windows': return 'Web Custom Format' + index;
    case 'macos': return 'org.w3.web-custom-format.type-' + index;
    // SPEC_CLASH(clipboard-linux-custom-name): A.8 leaves quoting incomplete.
    // Follow Chromium: the index is inside a complete quoted MIME parameter.
    case 'linux': case 'chromeos': case 'android': return 'application/web;type="custom/format' + index + '"';
  }
}

/** Platform families named by Appendix A; the adapter selects one explicitly. */
export type ClipboardPlatform = 'windows' | 'macos' | 'linux' | 'chromeos' | 'android';
/** A predefined Windows ID or an OS format name; registered numeric IDs remain adapter-owned. */
export type ClipboardFormat = number | string;

interface WellKnownFormats {
  text: ClipboardFormat;
  html: string;
  png: string;
  svg: string;
}

const mimeFormats: WellKnownFormats = {
  text: 'text/plain', html: 'text/html', png: 'image/png', svg: 'image/svg+xml',
};
const wellKnownFormats: Record<ClipboardPlatform, WellKnownFormats> = {
  windows: {
    // CF_UNICODETEXT is predefined, unlike the registered HTML/PNG/SVG names.
    // https://learn.microsoft.com/en-us/windows/win32/dataxchg/standard-clipboard-formats
    text: 13, html: 'HTML Format', png: 'PNG', svg: 'image/svg+xml',
  },
  macos: {
    // NSPasteboardTypeString/HTML/PNG and UTTypeSVG.identifier.
    text: 'public.utf8-plain-text', html: 'public.html', png: 'public.png', svg: 'public.svg-image',
  },
  linux: mimeFormats,
  chromeos: mimeFormats,
  android: mimeFormats,
};
