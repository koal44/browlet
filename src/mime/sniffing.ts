import {
  getMIMETypeEssence,
  isAudioOrVideoMIMEType,
  isHTMLMIMEType,
  isImageMIMEType,
  isXMLMIMEType,
  type MIMEType,
  type SupportsMIMEType,
} from './mime-type';
import { matchesBytePattern } from './pattern';
import { type ResourceMetadata } from './resource';
import {
  matchArchiveTypePattern,
  matchAudioOrVideoTypePattern,
  matchFontTypePattern,
  matchImageTypePattern,
} from './signatures';

export type MissingMIMETypeContext = 'style' | 'script';

/*
 * MIME Sniffing leaves the missing-type branches for style and script
 * contexts unspecified. Their eventual loaders supply that policy here.
 */
export type ResolveMissingMIMEType = (
  context: MissingMIMETypeContext,
  resource: ResourceMetadata,
) => MIMEType | undefined;

/*
 * MIME Sniffing §7 MIME type sniffing algorithm.
 *
 * https://mimesniff.spec.whatwg.org/#mime-type-sniffing-algorithm
 */
// SPEC_MISMATCH: (resource) -> void
export function sniffMIMEType(
  resource: ResourceMetadata,
  isSupportedByUserAgent: SupportsMIMEType,
): MIMEType {
  const supplied = resource.suppliedMIMEType;

  if (supplied !== undefined && (
    isXMLMIMEType(supplied) || isHTMLMIMEType(supplied)
  )) {
    return setComputedMIMEType(resource, supplied);
  }

  if (supplied === undefined || unknownMIMETypeEssences.has(
    getMIMETypeEssence(supplied),
  )) {
    return setComputedMIMEType(
      resource,
      identifyUnknownMIMEType(
        requireResourceHeader(resource),
        !resource.noSniff,
      ),
    );
  }

  if (resource.noSniff) return setComputedMIMEType(resource, supplied);

  const header = requireResourceHeader(resource);
  if (resource.checkForApacheBug) {
    return setComputedMIMEType(resource, distinguishTextOrBinary(header));
  }

  if (isImageMIMEType(supplied) && isSupportedByUserAgent(supplied)) {
    const matched = matchImageTypePattern(header);
    if (matched !== undefined) return setComputedMIMEType(resource, matched);
  }

  if (
    isAudioOrVideoMIMEType(supplied) &&
    isSupportedByUserAgent(supplied)
  ) {
    const matched = matchAudioOrVideoTypePattern(header);
    if (matched !== undefined) return setComputedMIMEType(resource, matched);
  }

  return setComputedMIMEType(resource, supplied);
}

/*
 * MIME Sniffing §7.1 rules for identifying an unknown MIME type.
 *
 * https://mimesniff.spec.whatwg.org/#identifying-a-resource-with-an-unknown-mime-type
 */
// SPEC_MISMATCH: (resource, sniff-scriptable = unset) -> MIME type string
export function identifyUnknownMIMEType(
  header: Uint8Array,
  sniffScriptable = false,
): MIMEType {
  if (sniffScriptable) {
    const matched = matchUnknownSignatures(header, scriptableSignatures);
    if (matched !== undefined) return matched;
  }

  let matched = matchUnknownSignatures(header, safeSignatures);
  if (matched !== undefined) return matched;

  matched = matchImageTypePattern(header);
  if (matched !== undefined) return matched;

  matched = matchAudioOrVideoTypePattern(header);
  if (matched !== undefined) return matched;

  matched = matchArchiveTypePattern(header);
  if (matched !== undefined) return matched;

  return containsBinaryDataByte(header)
    ? createMIMEType('application', 'octet-stream')
    : createMIMEType('text', 'plain');
}

/*
 * MIME Sniffing §7.2 rules for distinguishing text or binary.
 *
 * https://mimesniff.spec.whatwg.org/#rules-for-text-or-binary
 */
// SPEC_MISMATCH: (resource) -> void
export function distinguishTextOrBinary(header: Uint8Array): MIMEType {
  if (
    matchesBytes(header, 0xfe, 0xff) ||
    matchesBytes(header, 0xff, 0xfe) ||
    matchesBytes(header, 0xef, 0xbb, 0xbf) ||
    !containsBinaryDataByte(header)
  ) {
    return createMIMEType('text', 'plain');
  }
  return createMIMEType('application', 'octet-stream');
}

/* MIME Sniffing §8.1 browsing context. */
// SPEC_MISMATCH: MIME type sniffing algorithm(resource) -> void
export function sniffMIMETypeInBrowsingContext(
  resource: ResourceMetadata,
  isSupportedByUserAgent: SupportsMIMEType,
): MIMEType {
  return sniffMIMEType(resource, isSupportedByUserAgent);
}

/* MIME Sniffing §8.2 image context. */
// SPEC_MISMATCH: (resource) -> void
export function sniffMIMETypeInImageContext(
  resource: ResourceMetadata,
): MIMEType | undefined {
  return sniffPatternContext(resource, matchImageTypePattern);
}

/* MIME Sniffing §8.3 audio or video context. */
// SPEC_MISMATCH: (resource) -> void
export function sniffMIMETypeInAudioOrVideoContext(
  resource: ResourceMetadata,
): MIMEType | undefined {
  return sniffPatternContext(resource, matchAudioOrVideoTypePattern);
}

/* MIME Sniffing §8.4 plugin context. */
// SPEC_MISMATCH: (resource) -> void
export function sniffMIMETypeInPluginContext(
  resource: ResourceMetadata,
): MIMEType {
  // The specification marks this branch unfinished. Treat its explicit
  // application/octet-stream assignment as terminal rather than immediately
  // replacing it with the absent supplied type in the following step.
  return setComputedMIMEType(
    resource,
    resource.suppliedMIMEType ?? createMIMEType('application', 'octet-stream'),
  );
}

/* MIME Sniffing §8.5 style context. */
// SPEC_MISMATCH: (resource) -> void
export function sniffMIMETypeInStyleContext(
  resource: ResourceMetadata,
  resolveMissing: ResolveMissingMIMEType,
): MIMEType | undefined {
  return sniffUnfinishedContext(resource, 'style', resolveMissing);
}

/* MIME Sniffing §8.6 script context. */
// SPEC_MISMATCH: (resource) -> void
export function sniffMIMETypeInScriptContext(
  resource: ResourceMetadata,
  resolveMissing: ResolveMissingMIMEType,
): MIMEType | undefined {
  return sniffUnfinishedContext(resource, 'script', resolveMissing);
}

/* MIME Sniffing §8.7 font context. */
// SPEC_MISMATCH: (resource) -> void
export function sniffMIMETypeInFontContext(
  resource: ResourceMetadata,
): MIMEType | undefined {
  return sniffPatternContext(resource, matchFontTypePattern);
}

/* MIME Sniffing §8.8 text-track context. */
// SPEC_MISMATCH: (resource) -> void
export function sniffMIMETypeInTextTrackContext(
  resource: ResourceMetadata,
): MIMEType {
  return setComputedMIMEType(resource, createMIMEType('text', 'vtt'));
}

/* MIME Sniffing §8.9 cache-manifest context. */
// SPEC_MISMATCH: (resource) -> void
export function sniffMIMETypeInCacheManifestContext(
  resource: ResourceMetadata,
): MIMEType {
  return setComputedMIMEType(
    resource,
    createMIMEType('text', 'cache-manifest'),
  );
}

type Signature = {
  pattern: Uint8Array;
  mask: Uint8Array;
  type: string;
  subtype: string;
  tagTerminated?: boolean;
  ignored?: Set<number>;
};

type MatchTypePattern = (header: Uint8Array) => MIMEType | undefined;

function sniffPatternContext(
  resource: ResourceMetadata,
  match: MatchTypePattern,
): MIMEType | undefined {
  const supplied = resource.suppliedMIMEType;
  if (supplied !== undefined && isXMLMIMEType(supplied)) {
    return setComputedMIMEType(resource, supplied);
  }

  const matched = match(requireResourceHeader(resource));
  return setComputedMIMEType(resource, matched ?? supplied);
}

function sniffUnfinishedContext(
  resource: ResourceMetadata,
  context: MissingMIMETypeContext,
  resolveMissing: ResolveMissingMIMEType,
): MIMEType | undefined {
  const computed = resource.suppliedMIMEType ?? resolveMissing(context, resource);
  return setComputedMIMEType(resource, computed);
}

function matchUnknownSignatures(
  header: Uint8Array,
  signatures: Signature[],
): MIMEType | undefined {
  for (const signature of signatures) {
    const matched = signature.tagTerminated
      ? matchesTagTerminatedPattern(header, signature.pattern, signature.mask)
      : matchesBytePattern(
        header,
        signature.pattern,
        signature.mask,
        signature.ignored ?? noIgnoredBytes,
      );
    if (matched) return createMIMEType(signature.type, signature.subtype);
  }
  return undefined;
}

function matchesTagTerminatedPattern(
  header: Uint8Array,
  pattern: Uint8Array,
  mask: Uint8Array,
): boolean {
  let start = 0;
  while (start < header.length && whitespaceBytes.has(header[start]!)) start++;
  const end = start + pattern.length;
  if (end >= header.length) return false;

  for (let offset = 0; offset < pattern.length; offset++) {
    if ((header[start + offset]! & mask[offset]!) !== pattern[offset]) {
      return false;
    }
  }
  return tagTerminatingBytes.has(header[end]!);
}

function containsBinaryDataByte(header: Uint8Array): boolean {
  for (const byte of header) {
    if (
      byte <= 0x08 ||
      byte === 0x0b ||
      byte >= 0x0e && byte <= 0x1a ||
      byte >= 0x1c && byte <= 0x1f
    ) return true;
  }
  return false;
}

function matchesBytes(header: Uint8Array, ...expected: number[]): boolean {
  return expected.every((byte, offset) => header[offset] === byte);
}

function requireResourceHeader(resource: ResourceMetadata): Uint8Array {
  if (resource.resourceHeader === undefined) {
    throw new Error('The resource header must be read before MIME sniffing');
  }
  return resource.resourceHeader;
}

function setComputedMIMEType<T extends MIMEType | undefined>(
  resource: ResourceMetadata,
  mimeType: T,
): T {
  resource.computedMIMEType = mimeType;
  return mimeType;
}

function createMIMEType(type: string, subtype: string): MIMEType {
  return { type, subtype, parameters: new Map() };
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.of(...values);
}

function tagSignature(
  text: string,
  type: string,
  subtype: string,
): Signature {
  const pattern = bytes(...[...text].map((character) => character.charCodeAt(0)));
  const mask = bytes(...[...text].map((character) =>
    character >= 'A' && character <= 'Z' ? 0xdf : 0xff
  ));
  return { pattern, mask, type, subtype, tagTerminated: true };
}

const noIgnoredBytes = new Set<number>();
const whitespaceBytes = new Set([0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const tagTerminatingBytes = new Set([0x20, 0x3e]);
const unknownMIMETypeEssences = new Set([
  'unknown/unknown',
  'application/unknown',
  '*/*',
]);

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
    pattern: bytes(0x3c, 0x3f, 0x78, 0x6d, 0x6c),
    mask: bytes(0xff, 0xff, 0xff, 0xff, 0xff),
    type: 'text', subtype: 'xml',
    ignored: whitespaceBytes,
  },
  {
    pattern: bytes(0x25, 0x50, 0x44, 0x46, 0x2d),
    mask: bytes(0xff, 0xff, 0xff, 0xff, 0xff),
    type: 'application', subtype: 'pdf',
  },
];

const safeSignatures: Signature[] = [
  {
    pattern: bytes(
      0x25, 0x21, 0x50, 0x53, 0x2d, 0x41,
      0x64, 0x6f, 0x62, 0x65, 0x2d,
    ),
    mask: bytes(
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      0xff, 0xff, 0xff, 0xff, 0xff,
    ),
    type: 'application', subtype: 'postscript',
  },
  {
    pattern: bytes(0xfe, 0xff, 0x00, 0x00),
    mask: bytes(0xff, 0xff, 0x00, 0x00),
    type: 'text', subtype: 'plain',
  },
  {
    pattern: bytes(0xff, 0xfe, 0x00, 0x00),
    mask: bytes(0xff, 0xff, 0x00, 0x00),
    type: 'text', subtype: 'plain',
  },
  {
    pattern: bytes(0xef, 0xbb, 0xbf, 0x00),
    mask: bytes(0xff, 0xff, 0xff, 0x00),
    type: 'text', subtype: 'plain',
  },
];
