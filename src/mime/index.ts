export {
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
  type SupportsMIMEType,
} from './mime-type';

export { matchesBytePattern } from './pattern';

export {
  createResourceMetadata,
  detectSuppliedMIMEType,
  maximumResourceHeaderLength,
  readResourceHeader,
  type ReadResourceBytes,
  type ResourceMetadata,
  type ResourceMetadataOptions,
  type SuppliedMIMETypeSource,
} from './resource';

export {
  matchArchiveTypePattern,
  matchAudioOrVideoTypePattern,
  matchFontTypePattern,
  matchImageTypePattern,
  matchesMP3SignatureWithoutID3,
  matchesMP4Signature,
  matchesWebMSignature,
} from './signatures';

export {
  distinguishTextOrBinary,
  identifyUnknownMIMEType,
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
  type MissingMIMETypeContext,
  type ResolveMissingMIMEType,
} from './sniffing';
