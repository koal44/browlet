import type { Definition } from '../web-idl/declaration/index';
import {
  byteLengthQueuingStrategyIDL,
} from './byte-length-queuing-strategy';
import { countQueuingStrategyIDL } from './count-queuing-strategy';
import { genericTransformStreamIDL } from './generic-transform-stream';
import {
  queuingStrategyIDL, queuingStrategyInitIDL, queuingStrategySizeIDL,
} from './queuing-strategy';
import { readableByteStreamControllerIDL } from './readable-byte-stream-controller';
import {
  readableStreamBYOBReaderIDL,
  readableStreamBYOBReaderIncludesGenericReaderIDL,
  readableStreamBYOBReaderReadOptionsIDL,
} from './readable-stream-byob-reader';
import { readableStreamBYOBRequestIDL } from './readable-stream-byob-request';
import { readableStreamDefaultControllerIDL } from './readable-stream-default-controller';
import {
  readableStreamDefaultReaderIDL,
  readableStreamDefaultReaderIncludesGenericReaderIDL,
  readableStreamReadResultIDL,
} from './readable-stream-default-reader';
import { readableStreamGenericReaderIDL } from './readable-stream-generic-reader';
import {
  readableStreamControllerIDL, readableStreamGetReaderOptionsIDL,
  readableStreamIDL, readableStreamIteratorOptionsIDL,
  readableStreamReaderIDL, readableStreamReaderModeIDL,
  readableStreamTypeIDL, readableWritablePairIDL, streamPipeOptionsIDL,
  underlyingSourceCancelCallbackIDL, underlyingSourceIDL,
  underlyingSourcePullCallbackIDL, underlyingSourceStartCallbackIDL,
} from './readable-stream';
import { transformStreamDefaultControllerIDL } from './transform-stream-default-controller';
import {
  transformerCancelCallbackIDL, transformerFlushCallbackIDL, transformerIDL,
  transformerStartCallbackIDL, transformerTransformCallbackIDL,
  transformStreamIDL,
} from './transform-stream';
import {
  underlyingSinkAbortCallbackIDL, underlyingSinkCloseCallbackIDL,
  underlyingSinkIDL, underlyingSinkStartCallbackIDL,
  underlyingSinkWriteCallbackIDL, writableStreamIDL,
} from './writable-stream';
import {
  writableStreamDefaultControllerIDL,
} from './writable-stream-default-controller';
import {
  writableStreamDefaultWriterIDL,
} from './writable-stream-default-writer';

export {
  cancelReadableStream, cancelReadableStreamReader, closeReadableStream,
  createReadableStream, createReadableStreamFromAsyncSequence,
  createReadableStreamProxy, createReadableStreamWithByteReadingSupport,
  enqueueReadableStream, errorReadableStream,
  getReadableStreamBYOBRequestView, getReadableStreamDesiredSize,
  getReadableStreamReader, isReadableStreamClosed,
  isReadableStreamDisturbed, isReadableStreamErrored,
  isReadableStreamLocked, isReadableStreamReadable,
  pipeReadableStreamThrough, pipeReadableStreamTo,
  pullReadableStreamFromBytes, readAllBytes, readableStreamNeedsMoreData,
  readReadableStreamChunk, releaseReadableStreamReader,
  setUpReadableStreamReader, teeReadableStream,
} from './readable-stream-cross-spec';
export type { ReadableStreamImpl } from './readable-stream';
export { GenericTransformStreamMixin } from './generic-transform-stream';
export {
  createIdentityTransformStream, createTransformStream,
  enqueueTransformStream, errorTransformStream, terminateTransformStream,
} from './transform-stream-cross-spec';
export type { TransformStreamImpl } from './transform-stream';
export {
  abortWritableStream, closeWritableStream, createWritableStream,
  errorWritableStream, getWritableStreamSignal, getWritableStreamWriter,
  releaseWritableStreamWriter, setUpWritableStreamWriter,
  writeWritableStreamChunk,
} from './writable-stream-cross-spec';
export type { WritableStreamImpl } from './writable-stream';

export const streamsIDLDefinitions: Definition[] = [
  queuingStrategySizeIDL,
  queuingStrategyIDL,
  queuingStrategyInitIDL,
  byteLengthQueuingStrategyIDL,
  countQueuingStrategyIDL,
  genericTransformStreamIDL,
  underlyingSourceStartCallbackIDL,
  underlyingSourcePullCallbackIDL,
  underlyingSourceCancelCallbackIDL,
  readableStreamTypeIDL,
  readableStreamControllerIDL,
  underlyingSourceIDL,
  readableStreamReaderModeIDL,
  readableStreamGetReaderOptionsIDL,
  readableStreamIteratorOptionsIDL,
  readableWritablePairIDL,
  streamPipeOptionsIDL,
  readableStreamReaderIDL,
  readableStreamReadResultIDL,
  readableStreamIDL,
  readableStreamGenericReaderIDL,
  readableStreamDefaultReaderIDL,
  readableStreamDefaultReaderIncludesGenericReaderIDL,
  readableStreamBYOBReaderReadOptionsIDL,
  readableStreamBYOBReaderIDL,
  readableStreamBYOBReaderIncludesGenericReaderIDL,
  readableStreamDefaultControllerIDL,
  readableByteStreamControllerIDL,
  readableStreamBYOBRequestIDL,
  underlyingSinkStartCallbackIDL,
  underlyingSinkWriteCallbackIDL,
  underlyingSinkCloseCallbackIDL,
  underlyingSinkAbortCallbackIDL,
  underlyingSinkIDL,
  writableStreamIDL,
  writableStreamDefaultControllerIDL,
  writableStreamDefaultWriterIDL,
  transformerStartCallbackIDL,
  transformerFlushCallbackIDL,
  transformerTransformCallbackIDL,
  transformerCancelCallbackIDL,
  transformerIDL,
  transformStreamIDL,
  transformStreamDefaultControllerIDL,
];
