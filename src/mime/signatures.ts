import { type MIMEType } from './mime-type';
import { matchesBytePattern } from './pattern';

/*
 * MIME Sniffing §6.2 image type pattern matching algorithm.
 *
 * https://mimesniff.spec.whatwg.org/#matching-an-image-type-pattern
 */
export function matchImageTypePattern(input: Uint8Array): MIMEType | undefined {
  return matchSignatures(input, imageSignatures);
}

/*
 * MIME Sniffing §6.3 audio or video type pattern matching algorithm.
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
 * MIME Sniffing §6.4 font type pattern matching algorithm.
 *
 * https://mimesniff.spec.whatwg.org/#matching-a-font-type-pattern
 */
export function matchFontTypePattern(input: Uint8Array): MIMEType | undefined {
  return matchSignatures(input, fontSignatures);
}

/*
 * MIME Sniffing §6.5 archive type pattern matching algorithm.
 *
 * https://mimesniff.spec.whatwg.org/#matching-an-archive-type-pattern
 */
export function matchArchiveTypePattern(
  input: Uint8Array,
): MIMEType | undefined {
  return matchSignatures(input, archiveSignatures);
}

// https://mimesniff.spec.whatwg.org/#signature-for-mp4
export function matchesMP4Signature(input: Uint8Array): boolean {
  if (input.length < 12) return false;

  const boxSize = input[0]! * 0x1000000 +
    input[1]! * 0x10000 + input[2]! * 0x100 + input[3]!;
  if (input.length < boxSize || boxSize % 4 !== 0) return false;
  if (!matchesBytes(input, 4, 0x66, 0x74, 0x79, 0x70)) return false;
  if (matchesBytes(input, 8, 0x6d, 0x70, 0x34)) return true;

  for (let offset = 16; offset < boxSize; offset += 4) {
    if (matchesBytes(input, offset, 0x6d, 0x70, 0x34)) return true;
  }
  return false;
}

// https://mimesniff.spec.whatwg.org/#signature-for-webm
export function matchesWebMSignature(input: Uint8Array): boolean {
  if (input.length < 4) return false;
  if (!matchesBytes(input, 0, 0x1a, 0x45, 0xdf, 0xa3)) return false;

  let position = 4;
  while (position < input.length && position < 38) {
    if (matchesBytes(input, position, 0x42, 0x82)) {
      position += 2;
      if (position >= input.length) break;

      const vint = parseVint(input, position);
      if (vint === undefined) return false;
      position += vint.size;
      if (position >= input.length - 4) break;
      if (matchesPaddedBytes(input, position, 0x77, 0x65, 0x62, 0x6d)) {
        return true;
      }
    }
    position++;
  }
  return false;
}

// https://mimesniff.spec.whatwg.org/#signature-for-mp3-without-id3
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
  pattern: Uint8Array;
  mask: Uint8Array;
  type: string;
  subtype: string;
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
    if (matchesBytePattern(
      input,
      signature.pattern,
      signature.mask,
      noIgnoredBytes,
    )) {
      return createMIMEType(signature.type, signature.subtype);
    }
  }
  return undefined;
}

function createMIMEType(type: string, subtype: string): MIMEType {
  return { type, subtype, parameters: new Map() };
}

function matchesBytes(
  input: Uint8Array,
  offset: number,
  ...expected: number[]
): boolean {
  if (offset + expected.length > input.length) return false;
  return expected.every((value, index) => input[offset + index] === value);
}

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

function matchesPaddedBytes(
  input: Uint8Array,
  offset: number,
  ...pattern: number[]
): boolean {
  while (offset < input.length && input[offset] === 0) offset++;
  return matchesBytes(input, offset, ...pattern);
}

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

function computeMP3FrameSize(frame: MP3Frame): number {
  const scale = frame.version & 1 ? 144 : 72;
  return Math.floor(frame.bitrate * scale / frame.sampleRate) + frame.pad;
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.of(...values);
}

const noIgnoredBytes = new Set<number>();

const imageSignatures: Signature[] = [
  {
    pattern: bytes(0x00, 0x00, 0x01, 0x00),
    mask: bytes(0xff, 0xff, 0xff, 0xff),
    type: 'image', subtype: 'x-icon',
  },
  {
    pattern: bytes(0x00, 0x00, 0x02, 0x00),
    mask: bytes(0xff, 0xff, 0xff, 0xff),
    type: 'image', subtype: 'x-icon',
  },
  {
    pattern: bytes(0x42, 0x4d),
    mask: bytes(0xff, 0xff),
    type: 'image', subtype: 'bmp',
  },
  {
    pattern: bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61),
    mask: bytes(0xff, 0xff, 0xff, 0xff, 0xff, 0xff),
    type: 'image', subtype: 'gif',
  },
  {
    pattern: bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61),
    mask: bytes(0xff, 0xff, 0xff, 0xff, 0xff, 0xff),
    type: 'image', subtype: 'gif',
  },
  {
    pattern: bytes(
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00,
      0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
    ),
    mask: bytes(
      0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00,
      0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ),
    type: 'image', subtype: 'webp',
  },
  {
    pattern: bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    mask: bytes(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff),
    type: 'image', subtype: 'png',
  },
  {
    pattern: bytes(0xff, 0xd8, 0xff),
    mask: bytes(0xff, 0xff, 0xff),
    type: 'image', subtype: 'jpeg',
  },
];

const audioOrVideoSignatures: Signature[] = [
  {
    pattern: bytes(
      0x46, 0x4f, 0x52, 0x4d, 0x00, 0x00,
      0x00, 0x00, 0x41, 0x49, 0x46, 0x46,
    ),
    mask: bytes(
      0xff, 0xff, 0xff, 0xff, 0x00, 0x00,
      0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
    ),
    type: 'audio', subtype: 'aiff',
  },
  {
    pattern: bytes(0x49, 0x44, 0x33),
    mask: bytes(0xff, 0xff, 0xff),
    type: 'audio', subtype: 'mpeg',
  },
  {
    pattern: bytes(0x4f, 0x67, 0x67, 0x53, 0x00),
    mask: bytes(0xff, 0xff, 0xff, 0xff, 0xff),
    type: 'application', subtype: 'ogg',
  },
  {
    pattern: bytes(0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06),
    mask: bytes(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff),
    type: 'audio', subtype: 'midi',
  },
  {
    pattern: bytes(
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00,
      0x00, 0x00, 0x41, 0x56, 0x49, 0x20,
    ),
    mask: bytes(
      0xff, 0xff, 0xff, 0xff, 0x00, 0x00,
      0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
    ),
    type: 'video', subtype: 'avi',
  },
  {
    pattern: bytes(
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00,
      0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ),
    mask: bytes(
      0xff, 0xff, 0xff, 0xff, 0x00, 0x00,
      0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
    ),
    type: 'audio', subtype: 'wave',
  },
  // RFC 9639 registers this magic number and audio/flac. WHATWG's matching
  // table addition remains open as https://github.com/whatwg/mimesniff/pull/150.
  {
    pattern: bytes(0x66, 0x4c, 0x61, 0x43),
    mask: bytes(0xff, 0xff, 0xff, 0xff),
    type: 'audio', subtype: 'flac',
  },
];

const fontSignatures: Signature[] = [
  {
    pattern: bytes(
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x4c, 0x50,
    ),
    mask: bytes(
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff,
    ),
    type: 'application', subtype: 'vnd.ms-fontobject',
  },
  {
    pattern: bytes(0x00, 0x01, 0x00, 0x00),
    mask: bytes(0xff, 0xff, 0xff, 0xff),
    type: 'font', subtype: 'ttf',
  },
  {
    pattern: bytes(0x4f, 0x54, 0x54, 0x4f),
    mask: bytes(0xff, 0xff, 0xff, 0xff),
    type: 'font', subtype: 'otf',
  },
  {
    pattern: bytes(0x74, 0x74, 0x63, 0x66),
    mask: bytes(0xff, 0xff, 0xff, 0xff),
    type: 'font', subtype: 'collection',
  },
  {
    pattern: bytes(0x77, 0x4f, 0x46, 0x46),
    mask: bytes(0xff, 0xff, 0xff, 0xff),
    type: 'font', subtype: 'woff',
  },
  {
    pattern: bytes(0x77, 0x4f, 0x46, 0x32),
    mask: bytes(0xff, 0xff, 0xff, 0xff),
    type: 'font', subtype: 'woff2',
  },
];

const archiveSignatures: Signature[] = [
  {
    pattern: bytes(0x1f, 0x8b, 0x08),
    mask: bytes(0xff, 0xff, 0xff),
    type: 'application', subtype: 'x-gzip',
  },
  {
    pattern: bytes(0x50, 0x4b, 0x03, 0x04),
    mask: bytes(0xff, 0xff, 0xff, 0xff),
    type: 'application', subtype: 'zip',
  },
  {
    pattern: bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00),
    mask: bytes(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff),
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
