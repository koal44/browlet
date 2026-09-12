import type { Definition } from '../web-idl/declaration/index';
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
  UTF8Decoder, UTF8Encoder, utf8DecodeQueue, utf8DecodeWithoutBOMQueue,
  utf8DecodeWithoutBOMOrFailQueue, utf8EncodeQueue,
} from './codecs/utf-8';

export const encodingIDLDefinitions: Definition[] = [
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
