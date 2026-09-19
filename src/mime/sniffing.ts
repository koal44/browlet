import {
  createMIMEType, getMIMETypeEssence,
  isAudioOrVideoMIMEType, isHTMLMIMEType,
  isImageMIMEType, isXMLMIMEType,
  type MIMEType, type SupportsMIMEType,
} from './mime-type';
import { type SuppliedMIMETypeDetection } from './resource';
import {
  matchArchiveTypePattern, matchAudioOrVideoTypePattern,
  matchFontTypePattern, matchImageTypePattern,
  matchSafeSignature, matchScriptableSignature,
} from './signatures';

export type MissingMIMETypeContext = 'style' | 'script';

/*
 * MIME Sniffing leaves the missing-type branches for style and script
 * contexts unspecified. Their eventual loaders supply that policy here.
 */
export type ResolveMissingMIMEType = (
  context: MissingMIMETypeContext,
) => MIMEType | undefined;

/*
 * MIME Sniffing §7 MIME type sniffing algorithm.
 *
 * https://mimesniff.spec.whatwg.org/#mime-type-sniffing-algorithm
 */
export function sniffMIMEType(
  detection: SuppliedMIMETypeDetection,
  resourceHeader: Uint8Array,
  noSniff: boolean,
  isSupportedByUserAgent: SupportsMIMEType,
): MIMEType {
  const supplied = detection.suppliedMIMEType;

  if (supplied !== undefined && (
    isXMLMIMEType(supplied) || isHTMLMIMEType(supplied)
  )) {
    return supplied;
  }

  if (supplied === undefined || unknownMIMETypeEssences.has(
    getMIMETypeEssence(supplied),
  )) {
    return identifyUnknownMIMEType(
      resourceHeader,
      !noSniff,
    );
  }

  if (noSniff) return supplied;

  if (detection.checkForApacheBug) {
    return distinguishTextOrBinary(resourceHeader);
  }

  if (isImageMIMEType(supplied) && isSupportedByUserAgent(supplied)) {
    const matched = matchImageTypePattern(resourceHeader);
    if (matched !== undefined) return matched;
  }

  if (
    isAudioOrVideoMIMEType(supplied) &&
    isSupportedByUserAgent(supplied)
  ) {
    const matched = matchAudioOrVideoTypePattern(resourceHeader);
    if (matched !== undefined) return matched;
  }

  return supplied;
}

/*
 * MIME Sniffing §7.1 rules for identifying an unknown MIME type.
 *
 * https://mimesniff.spec.whatwg.org/#identifying-a-resource-with-an-unknown-mime-type
 */
export function identifyUnknownMIMEType(
  header: Uint8Array,
  sniffScriptable = false,
): MIMEType {
  if (sniffScriptable) {
    const matched = matchScriptableSignature(header);
    if (matched !== undefined) return matched;
  }

  let matched = matchSafeSignature(header);
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
export function distinguishTextOrBinary(header: Uint8Array): MIMEType {
  const hasBOM =
    (header[0] === 0xfe && header[1] === 0xff) ||
    (header[0] === 0xff && header[1] === 0xfe) ||
    (header[0] === 0xef && header[1] === 0xbb && header[2] === 0xbf);
  if (
    hasBOM ||
    !containsBinaryDataByte(header)
  ) {
    return createMIMEType('text', 'plain');
  }
  return createMIMEType('application', 'octet-stream');
}

/*
 * MIME Sniffing §8.1 sniffing in a browsing context.
 *
 * https://mimesniff.spec.whatwg.org/#sniffing-in-a-browsing-context
 */
export function sniffMIMETypeInBrowsingContext(
  detection: SuppliedMIMETypeDetection,
  resourceHeader: Uint8Array,
  noSniff: boolean,
  isSupportedByUserAgent: SupportsMIMEType,
): MIMEType {
  return sniffMIMEType(
    detection,
    resourceHeader,
    noSniff,
    isSupportedByUserAgent,
  );
}

/*
 * MIME Sniffing §8.2 sniffing in an image context.
 *
 * https://mimesniff.spec.whatwg.org/#sniffing-in-an-image-context
 */
export function sniffMIMETypeInImageContext(
  suppliedMIMEType: MIMEType | undefined,
  resourceHeader: Uint8Array,
): MIMEType | undefined {
  return sniffPatternContext(
    suppliedMIMEType,
    resourceHeader,
    matchImageTypePattern,
  );
}

/*
 * MIME Sniffing §8.3 sniffing in an audio or video context.
 *
 * https://mimesniff.spec.whatwg.org/#sniffing-in-an-audio-or-video-context
 */
export function sniffMIMETypeInAudioOrVideoContext(
  suppliedMIMEType: MIMEType | undefined,
  resourceHeader: Uint8Array,
): MIMEType | undefined {
  return sniffPatternContext(
    suppliedMIMEType,
    resourceHeader,
    matchAudioOrVideoTypePattern,
  );
}

/*
 * MIME Sniffing §8.4 sniffing in a plugin context.
 *
 * https://mimesniff.spec.whatwg.org/#sniffing-in-a-plugin-context
 */
export function sniffMIMETypeInPluginContext(
  suppliedMIMEType: MIMEType | undefined,
): MIMEType {
  // The specification marks this branch unfinished. Treat its explicit
  // application/octet-stream assignment as terminal rather than immediately
  // replacing it with the absent supplied type in the following step.
  return suppliedMIMEType ?? createMIMEType('application', 'octet-stream');
}

/*
 * MIME Sniffing §8.5 sniffing in a style context.
 *
 * https://mimesniff.spec.whatwg.org/#sniffing-in-a-style-context
 */
export function sniffMIMETypeInStyleContext(
  suppliedMIMEType: MIMEType | undefined,
  resolveMissing: ResolveMissingMIMEType,
): MIMEType | undefined {
  return suppliedMIMEType ?? resolveMissing('style');
}

/*
 * MIME Sniffing §8.6 sniffing in a script context.
 *
 * https://mimesniff.spec.whatwg.org/#sniffing-in-a-script-context
 */
export function sniffMIMETypeInScriptContext(
  suppliedMIMEType: MIMEType | undefined,
  resolveMissing: ResolveMissingMIMEType,
): MIMEType | undefined {
  return suppliedMIMEType ?? resolveMissing('script');
}

/*
 * MIME Sniffing §8.7 sniffing in a font context.
 *
 * https://mimesniff.spec.whatwg.org/#sniffing-in-a-font-context
 */
export function sniffMIMETypeInFontContext(
  suppliedMIMEType: MIMEType | undefined,
  resourceHeader: Uint8Array,
): MIMEType | undefined {
  return sniffPatternContext(
    suppliedMIMEType,
    resourceHeader,
    matchFontTypePattern,
  );
}

/*
 * MIME Sniffing §8.8 sniffing in a text track context.
 *
 * https://mimesniff.spec.whatwg.org/#sniffing-in-a-text-track-context
 */
export function sniffMIMETypeInTextTrackContext(): MIMEType {
  return createMIMEType('text', 'vtt');
}

/*
 * MIME Sniffing §8.9 sniffing in a cache manifest context.
 *
 * https://mimesniff.spec.whatwg.org/#sniffing-in-a-cache-manifest-context
 */
export function sniffMIMETypeInCacheManifestContext(): MIMEType {
  return createMIMEType('text', 'cache-manifest');
}

type MatchTypePattern = (header: Uint8Array) => MIMEType | undefined;

function sniffPatternContext(
  suppliedMIMEType: MIMEType | undefined,
  resourceHeader: Uint8Array,
  match: MatchTypePattern,
): MIMEType | undefined {
  if (suppliedMIMEType !== undefined && isXMLMIMEType(suppliedMIMEType)) {
    return suppliedMIMEType;
  }

  const matched = match(resourceHeader);
  return matched ?? suppliedMIMEType;
}

/*
 * MIME Sniffing §3 binary data byte.
 *
 * https://mimesniff.spec.whatwg.org/#binary-data-byte
 */
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

const unknownMIMETypeEssences = new Set([
  'unknown/unknown',
  'application/unknown',
  '*/*',
]);
