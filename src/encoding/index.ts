import type { JSEnvironment } from '../js-engine/index';
import type { Definition } from '../web-idl/index';
import {
  textDecodeOptionsIDL, textDecoderCommonIDL, textDecoderIDL,
  textDecoderIncludesCommonIDL, textDecoderOptionsIDL,
} from './text-decoder';
import {
  textDecoderStreamIDL, textDecoderStreamIncludesCommonIDL,
  textDecoderStreamIncludesGenericTransformStreamIDL,
} from './text-decoder-stream';
import {
  textEncoderCommonIDL, textEncoderEncodeIntoResultIDL, textEncoderIDL,
  textEncoderIncludesCommonIDL,
} from './text-encoder';
import {
  textEncoderStreamIDL, textEncoderStreamIncludesCommonIDL,
  textEncoderStreamIncludesGenericTransformStreamIDL,
} from './text-encoder-stream';

export {
  type Encoding, type OutputEncoding,
  bomSniff, decode, decodeQueue, encode, encodeQueue, encodeOrFail, encodeOrFailSync,
  getDecoder, getEncoder, getEncoding, getOutputEncoding,
} from './encodings';
export { endOfQueue, IOQueue, processQueue, type Decoder, type Encoder } from './io-queue';
export { getSingleByteCodec } from './codecs/single-byte';
export {
  UTF8Decoder, UTF8Encoder, utf8Decode, utf8DecodeQueue,
  utf8DecodeWithoutBOM, utf8DecodeWithoutBOMQueue,
  utf8DecodeWithoutBOMOrFail, utf8DecodeWithoutBOMOrFailQueue,
  utf8Encode, utf8EncodeQueue,
} from './codecs/utf-8';
export { TextDecoderStreamImpl } from './text-decoder-stream';

export const encodingIDLDefinitions: Definition<JSEnvironment>[] = [
  textDecoderCommonIDL,
  textDecoderOptionsIDL,
  textDecodeOptionsIDL,
  textDecoderIDL,
  textDecoderIncludesCommonIDL,
  textEncoderCommonIDL,
  textEncoderEncodeIntoResultIDL,
  textEncoderIDL,
  textEncoderIncludesCommonIDL,
  textDecoderStreamIDL,
  textDecoderStreamIncludesCommonIDL,
  textDecoderStreamIncludesGenericTransformStreamIDL,
  textEncoderStreamIDL,
  textEncoderStreamIncludesCommonIDL,
  textEncoderStreamIncludesGenericTransformStreamIDL,
];
