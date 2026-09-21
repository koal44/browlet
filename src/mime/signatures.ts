import { createMIMEType, type MIMEType } from './mime-type';
import { InternalError } from '../infra/internal-error';

/*
 * MIME Sniffing §6 pattern matching algorithm.
 *
 * https://mimesniff.spec.whatwg.org/#pattern-matching-algorithm
 */
export function matchesBytePattern(
  input: Uint8Array,
  pattern: number[],
  mask: number[],
  ignored: Set<number>,
): boolean {
  if (pattern.length !== mask.length) {
    throw new InternalError('A byte pattern and its mask must have equal lengths');
  }
  if (input.length < pattern.length) return false;

  let start = 0;
  while (start < input.length && ignored.has(input[start]!)) start++;
  if (input.length - start < pattern.length) return false;

  for (let position = 0; position < pattern.length; position++) {
    const masked = input[start + position]! & mask[position]!;
    if (masked !== pattern[position]) return false;
  }
  return true;
}

/*
 * MIME Sniffing §6.1 matching an image type pattern.
 *
 * https://mimesniff.spec.whatwg.org/#matching-an-image-type-pattern
 */
export function matchImageTypePattern(input: Uint8Array): MIMEType | undefined {
  return matchSignatures(input, imageSignatures);
}

/*
 * MIME Sniffing §6.2 matching an audio or video type pattern.
 *
 * https://mimesniff.spec.whatwg.org/#matching-an-audio-or-video-type-pattern
 */
export function matchAudioOrVideoTypePattern(
  input: Uint8Array,
): MIMEType | undefined {
  const matched = matchSignatures(input, audioOrVideoSignatures);
  if (matched !== undefined) return matched;
  if (matchesMP4Signature(input)) return createMIMEType('video', 'mp4');
  if (matchesWebMSignature(input)) return createMIMEType('video', 'webm');
  if (matchesMP3SignatureWithoutID3(input)) {
    return createMIMEType('audio', 'mpeg');
  }
  return undefined;
}

/*
 * MIME Sniffing §6.3 matching a font type pattern.
 *
 * https://mimesniff.spec.whatwg.org/#matching-a-font-type-pattern
 */
export function matchFontTypePattern(input: Uint8Array): MIMEType | undefined {
  return matchSignatures(input, fontSignatures);
}

/*
 * MIME Sniffing §6.4 matching an archive type pattern.
 *
 * https://mimesniff.spec.whatwg.org/#matching-an-archive-type-pattern
 */
export function matchArchiveTypePattern(
  input: Uint8Array,
): MIMEType | undefined {
  return matchSignatures(input, archiveSignatures);
}

/* MIME Sniffing §7.1 signatures for scriptable MIME types. */
export function matchScriptableSignature(
  input: Uint8Array,
): MIMEType | undefined {
  return matchSignatures(input, scriptableSignatures);
}

/* MIME Sniffing §7.1 signatures that are safe for non-scriptable sniffing. */
export function matchSafeSignature(input: Uint8Array): MIMEType | undefined {
  return matchSignatures(input, safeSignatures);
}

/*
 * MIME Sniffing §6.2.1 matches the signature for MP4.
 *
 * https://mimesniff.spec.whatwg.org/#signature-for-mp4
 */
export function matchesMP4Signature(input: Uint8Array): boolean {
  if (input.length < 12) return false;

  const boxSize = input[0]! * 0x1000000 +
    input[1]! * 0x10000 + input[2]! * 0x100 + input[3]!;
  if (input.length < boxSize || boxSize % 4 !== 0) return false;
  if (!matchesBytes(input, 4, fileTypeBoxPattern)) return false;
  if (matchesBytes(input, 8, mp4BrandPattern)) return true;

  for (let offset = 16; offset < boxSize; offset += 4) {
    if (matchesBytes(input, offset, mp4BrandPattern)) return true;
  }
  return false;
}

/*
 * MIME Sniffing §6.2.2 matches the signature for WebM.
 *
 * https://mimesniff.spec.whatwg.org/#signature-for-webm
 */
export function matchesWebMSignature(input: Uint8Array): boolean {
  if (input.length < 4) return false;
  if (!matchesBytes(input, 0, ebmlHeaderPattern)) return false;

  let position = 4;
  while (position < input.length && position < 38) {
    if (matchesBytes(input, position, docTypeElementPattern)) {
      position += 2;
      if (position >= input.length) break;

      const vint = parseVint(input, position);
      if (vint === undefined) return false;
      position += vint.size;
      if (vint.value > BigInt(input.length - position)) break;

      const end = position + Number(vint.value) - 1;
      if (matchesPaddedBytes(input, position, end, webMDocTypePattern)) {
        return true;
      }
    }
    position++;
  }
  return false;
}

/*
 * MIME Sniffing §6.2.3 matches the signature for MP3 without ID3.
 *
 * https://mimesniff.spec.whatwg.org/#signature-for-mp3-without-id3
 */
export function matchesMP3SignatureWithoutID3(input: Uint8Array): boolean {
  // The published algorithm still contains conjunction and remaining-length
  // errors. These corrections follow its originating Gecko algorithm.
  // https://github.com/whatwg/mimesniff/issues/70
  if (!matchesMP3Header(input, 0)) return false;

  const frame = parseMP3Frame(input, 0);
  const skipped = computeMP3FrameSize(frame);
  if (skipped < 4 || skipped > input.length) return false;
  return matchesMP3Header(input, skipped);
}

type Signature = {
  pattern: number[];
  mask: number[];
  type: string;
  subtype: string;
  tagTerminated?: boolean;
  ignored?: Set<number>;
};

type MP3Frame = {
  version: number;
  bitrate: number;
  sampleRate: number;
  pad: number;
};

type Vint = {
  value: bigint;
  size: number;
};

function matchSignatures(
  input: Uint8Array,
  signatures: Signature[],
): MIMEType | undefined {
  for (const signature of signatures) {
    const matched = signature.tagTerminated
      ? matchesTagTerminatedPattern(input, signature.pattern, signature.mask)
      : matchesBytePattern(
        input,
        signature.pattern,
        signature.mask,
        signature.ignored ?? noIgnoredBytes,
      );
    if (matched) {
      return createMIMEType(signature.type, signature.subtype);
    }
  }
  return undefined;
}

function matchesTagTerminatedPattern(
  input: Uint8Array,
  pattern: number[],
  mask: number[],
): boolean {
  let start = 0;
  while (start < input.length && whitespaceBytes.has(input[start]!)) start++;
  const end = start + pattern.length;
  if (end >= input.length) return false;

  for (let offset = 0; offset < pattern.length; offset++) {
    if ((input[start + offset]! & mask[offset]!) !== pattern[offset]) {
      return false;
    }
  }
  return tagTerminatingBytes.has(input[end]!);
}

function matchesBytes(
  input: Uint8Array,
  offset: number,
  pattern: number[],
): boolean {
  if (offset + pattern.length > input.length) return false;
  for (let index = 0; index < pattern.length; index++) {
    if (input[offset + index] !== pattern[index]) return false;
  }
  return true;
}

/*
 * MIME Sniffing §6.2.2 parsing a VINT.
 *
 * https://mimesniff.spec.whatwg.org/#parse-a-vint
 */
function parseVint(
  input: Uint8Array,
  offset: number,
): Vint | undefined {
  const first = input[offset];
  if (first === undefined) return undefined;

  let mask = 0x80;
  let size = 1;
  while (size < 8 && (first & mask) === 0) {
    mask >>= 1;
    size++;
  }
  if (offset + size > input.length) return undefined;

  let value = BigInt(first & (~mask & 0xff));
  for (let index = 1; index < size; index++) {
    value = value << 8n | BigInt(input[offset + index]!);
  }
  return { value, size };
}

/*
 * MIME Sniffing §6.2.2 matching a padded sequence.
 *
 * https://mimesniff.spec.whatwg.org/#matching-a-padded-sequence
 */
function matchesPaddedBytes(
  input: Uint8Array,
  offset: number,
  end: number,
  pattern: number[],
): boolean {
  if (end >= input.length) return false;

  const patternOffset = end - pattern.length + 1;
  if (patternOffset < offset) return false;
  while (offset < patternOffset && input[offset] === 0) offset++;
  if (offset !== patternOffset) return false;
  return matchesBytes(input, patternOffset, pattern);
}

/*
 * MIME Sniffing §6.2.3 matching an MP3 header.
 *
 * https://mimesniff.spec.whatwg.org/#match-an-mp3-header
 */
function matchesMP3Header(input: Uint8Array, offset: number): boolean {
  if (input.length - offset < 4) return false;
  if (input[offset] !== 0xff || (input[offset + 1]! & 0xe0) !== 0xe0) {
    return false;
  }

  const layer = (input[offset + 1]! & 0x06) >> 1;
  if (layer === 0) return false;
  const bitrate = (input[offset + 2]! & 0xf0) >> 4;
  if (bitrate === 15) return false;
  const sampleRate = (input[offset + 2]! & 0x0c) >> 2;
  if (sampleRate === 3) return false;
  return 4 - layer === 3;
}

/*
 * MIME Sniffing §6.2.3 parsing an MP3 frame.
 *
 * https://mimesniff.spec.whatwg.org/#parse-an-mp3-frame
 */
function parseMP3Frame(input: Uint8Array, offset: number): MP3Frame {
  const version = (input[offset + 1]! & 0x18) >> 3;
  const bitrateIndex = (input[offset + 2]! & 0xf0) >> 4;
  // The specification prose currently assigns these two tables in reverse.
  const bitrate = version & 1
    ? mpeg1Bitrates[bitrateIndex]!
    : mpeg2Bitrates[bitrateIndex]!;

  const sampleRateIndex = (input[offset + 2]! & 0x0c) >> 2;
  let sampleRate = sampleRates[sampleRateIndex]!;
  if (version === 2) sampleRate /= 2;
  if (version === 0) sampleRate /= 4;

  const pad = (input[offset + 2]! & 0x02) >> 1;
  return { version, bitrate, sampleRate, pad };
}

/*
 * MIME Sniffing §6.2.3 computing an MP3 frame size.
 *
 * https://mimesniff.spec.whatwg.org/#compute-an-mp3-frame-size
 */
function computeMP3FrameSize(frame: MP3Frame): number {
  // The specification prose currently applies these scale factors to the
  // wrong raw MPEG version values.
  const scale = frame.version & 1 ? 144 : 72;
  return Math.floor(frame.bitrate * scale / frame.sampleRate) + frame.pad;
}

function tagSignature(
  text: string,
  type: string,
  subtype: string,
): Signature {
  const pattern = [...text].map((character) => character.charCodeAt(0));
  const mask = [...text].map((character) =>
    character >= 'A' && character <= 'Z' ? 0xdf : 0xff
  );
  return { pattern, mask, type, subtype, tagTerminated: true };
}

const noIgnoredBytes = new Set<number>();
const whitespaceBytes = new Set([0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const tagTerminatingBytes = new Set([0x20, 0x3e]);
const fileTypeBoxPattern = [0x66, 0x74, 0x79, 0x70];
const mp4BrandPattern = [0x6d, 0x70, 0x34];
const ebmlHeaderPattern = [0x1a, 0x45, 0xdf, 0xa3];
const docTypeElementPattern = [0x42, 0x82];
const webMDocTypePattern = [0x77, 0x65, 0x62, 0x6d];

const scriptableSignatures: Signature[] = [
  tagSignature('<!DOCTYPE HTML', 'text', 'html'),
  tagSignature('<HTML', 'text', 'html'),
  tagSignature('<HEAD', 'text', 'html'),
  tagSignature('<SCRIPT', 'text', 'html'),
  tagSignature('<IFRAME', 'text', 'html'),
  tagSignature('<H1', 'text', 'html'),
  tagSignature('<DIV', 'text', 'html'),
  tagSignature('<FONT', 'text', 'html'),
  tagSignature('<TABLE', 'text', 'html'),
  tagSignature('<A', 'text', 'html'),
  tagSignature('<STYLE', 'text', 'html'),
  tagSignature('<TITLE', 'text', 'html'),
  tagSignature('<B', 'text', 'html'),
  tagSignature('<BODY', 'text', 'html'),
  tagSignature('<BR', 'text', 'html'),
  tagSignature('<P', 'text', 'html'),
  tagSignature('<!--', 'text', 'html'),
  {
    pattern: [0x3c, 0x3f, 0x78, 0x6d, 0x6c],
    mask: [0xff, 0xff, 0xff, 0xff, 0xff],
    type: 'text', subtype: 'xml',
    ignored: whitespaceBytes,
  },
  {
    pattern: [0x25, 0x50, 0x44, 0x46, 0x2d],
    mask: [0xff, 0xff, 0xff, 0xff, 0xff],
    type: 'application', subtype: 'pdf',
  },
];

const safeSignatures: Signature[] = [
  {
    pattern: [
      0x25, 0x21, 0x50, 0x53, 0x2d, 0x41,
      0x64, 0x6f, 0x62, 0x65, 0x2d,
    ],
    mask: [
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      0xff, 0xff, 0xff, 0xff, 0xff,
    ],
    type: 'application', subtype: 'postscript',
  },
  {
    pattern: [0xfe, 0xff, 0x00, 0x00],
    mask: [0xff, 0xff, 0x00, 0x00],
    type: 'text', subtype: 'plain',
  },
  {
    pattern: [0xff, 0xfe, 0x00, 0x00],
    mask: [0xff, 0xff, 0x00, 0x00],
    type: 'text', subtype: 'plain',
  },
  {
    pattern: [0xef, 0xbb, 0xbf, 0x00],
    mask: [0xff, 0xff, 0xff, 0x00],
    type: 'text', subtype: 'plain',
  },
];

const imageSignatures: Signature[] = [
  {
    pattern: [0x00, 0x00, 0x01, 0x00],
    mask: [0xff, 0xff, 0xff, 0xff],
    type: 'image', subtype: 'x-icon',
  },
  {
    pattern: [0x00, 0x00, 0x02, 0x00],
    mask: [0xff, 0xff, 0xff, 0xff],
    type: 'image', subtype: 'x-icon',
  },
  {
    pattern: [0x42, 0x4d],
    mask: [0xff, 0xff],
    type: 'image', subtype: 'bmp',
  },
  {
    pattern: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    mask: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    type: 'image', subtype: 'gif',
  },
  {
    pattern: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
    mask: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    type: 'image', subtype: 'gif',
  },
  {
    pattern: [
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00,
      0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
    ],
    mask: [
      0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00,
      0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ],
    type: 'image', subtype: 'webp',
  },
  {
    pattern: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    mask: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    type: 'image', subtype: 'png',
  },
  {
    pattern: [0xff, 0xd8, 0xff],
    mask: [0xff, 0xff, 0xff],
    type: 'image', subtype: 'jpeg',
  },
];

const audioOrVideoSignatures: Signature[] = [
  {
    pattern: [
      0x46, 0x4f, 0x52, 0x4d, 0x00, 0x00,
      0x00, 0x00, 0x41, 0x49, 0x46, 0x46,
    ],
    mask: [
      0xff, 0xff, 0xff, 0xff, 0x00, 0x00,
      0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
    ],
    type: 'audio', subtype: 'aiff',
  },
  {
    pattern: [0x49, 0x44, 0x33],
    mask: [0xff, 0xff, 0xff],
    type: 'audio', subtype: 'mpeg',
  },
  {
    pattern: [0x4f, 0x67, 0x67, 0x53, 0x00],
    mask: [0xff, 0xff, 0xff, 0xff, 0xff],
    type: 'application', subtype: 'ogg',
  },
  {
    pattern: [0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06],
    mask: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    type: 'audio', subtype: 'midi',
  },
  {
    pattern: [
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00,
      0x00, 0x00, 0x41, 0x56, 0x49, 0x20,
    ],
    mask: [
      0xff, 0xff, 0xff, 0xff, 0x00, 0x00,
      0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
    ],
    type: 'video', subtype: 'avi',
  },
  {
    pattern: [
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00,
      0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ],
    mask: [
      0xff, 0xff, 0xff, 0xff, 0x00, 0x00,
      0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
    ],
    type: 'audio', subtype: 'wave',
  },
  // RFC 9639 registers this magic number and audio/flac. WHATWG's matching
  // table addition remains open as https://github.com/whatwg/mimesniff/pull/150.
  {
    pattern: [0x66, 0x4c, 0x61, 0x43],
    mask: [0xff, 0xff, 0xff, 0xff],
    type: 'audio', subtype: 'flac',
  },
];

const fontSignatures: Signature[] = [
  {
    pattern: [
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x4c, 0x50,
    ],
    mask: [
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff,
    ],
    type: 'application', subtype: 'vnd.ms-fontobject',
  },
  {
    pattern: [0x00, 0x01, 0x00, 0x00],
    mask: [0xff, 0xff, 0xff, 0xff],
    type: 'font', subtype: 'ttf',
  },
  {
    pattern: [0x4f, 0x54, 0x54, 0x4f],
    mask: [0xff, 0xff, 0xff, 0xff],
    type: 'font', subtype: 'otf',
  },
  {
    pattern: [0x74, 0x74, 0x63, 0x66],
    mask: [0xff, 0xff, 0xff, 0xff],
    type: 'font', subtype: 'collection',
  },
  {
    pattern: [0x77, 0x4f, 0x46, 0x46],
    mask: [0xff, 0xff, 0xff, 0xff],
    type: 'font', subtype: 'woff',
  },
  {
    pattern: [0x77, 0x4f, 0x46, 0x32],
    mask: [0xff, 0xff, 0xff, 0xff],
    type: 'font', subtype: 'woff2',
  },
];

const archiveSignatures: Signature[] = [
  {
    pattern: [0x1f, 0x8b, 0x08],
    mask: [0xff, 0xff, 0xff],
    type: 'application', subtype: 'x-gzip',
  },
  {
    pattern: [0x50, 0x4b, 0x03, 0x04],
    mask: [0xff, 0xff, 0xff, 0xff],
    type: 'application', subtype: 'zip',
  },
  {
    pattern: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00],
    mask: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    type: 'application', subtype: 'x-rar-compressed',
  },
];

const mpeg1Bitrates = [
  0, 32000, 40000, 48000, 56000, 64000, 80000, 96000,
  112000, 128000, 160000, 192000, 224000, 256000, 320000,
];

const mpeg2Bitrates = [
  0, 8000, 16000, 24000, 32000, 40000, 48000, 56000,
  64000, 80000, 96000, 112000, 128000, 144000, 160000,
];

const sampleRates = [44100, 48000, 32000];
