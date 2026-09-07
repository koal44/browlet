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

export { decode, encode, getEncoding } from './hooks';

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
