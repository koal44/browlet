import type { Definition } from '../web-idl/index';
import {
  byteLengthQueuingStrategyIDL, countQueuingStrategyIDL, queuingStrategyIDL,
  queuingStrategyInitIDL, queuingStrategySizeIDL,
} from './queuing-strategy';
import {
  readableByteStreamControllerIDL, readableStreamBYOBReaderIDL,
  readableStreamBYOBReaderIncludesGenericReaderIDL,
  readableStreamBYOBReaderReadOptionsIDL, readableStreamBYOBRequestIDL,
  readableStreamDefaultControllerIDL, readableStreamDefaultReaderIDL,
  readableStreamDefaultReaderIncludesGenericReaderIDL, readableStreamReadResultIDL,
  readableStreamGenericReaderIDL, readableStreamControllerIDL,
  readableStreamGetReaderOptionsIDL, readableStreamIDL, readableStreamIteratorOptionsIDL,
  readableStreamReaderIDL, readableStreamReaderModeIDL, readableStreamTypeIDL,
  readableWritablePairIDL, streamPipeOptionsIDL, underlyingSourceCancelCallbackIDL,
  underlyingSourceIDL, underlyingSourcePullCallbackIDL, underlyingSourceStartCallbackIDL,
} from './readable-stream';
import {
  transformerCancelCallbackIDL, transformerFlushCallbackIDL, transformerIDL,
  transformerStartCallbackIDL, transformerTransformCallbackIDL, transformStreamIDL,
  transformStreamDefaultControllerIDL, genericTransformStreamIDL,
} from './transform-stream';
import {
  underlyingSinkAbortCallbackIDL, underlyingSinkCloseCallbackIDL, underlyingSinkIDL,
  underlyingSinkStartCallbackIDL, underlyingSinkWriteCallbackIDL, writableStreamIDL,
  writableStreamDefaultControllerIDL, writableStreamDefaultWriterIDL,
} from './writable-stream';

export {
  extractHighWaterMark, extractSizeAlgorithm, type QueuingStrategyRecord,
} from './queuing-strategy';
export {
  ReadableStreamImpl, ReadableStreamDefaultControllerImpl, ReadableStreamDefaultReaderImpl,
  readableStreamReadResultIDL, type ReadableByteStreamControllerImpl, type ReadableStreamReadResult,
} from './readable-stream';
export {
  GenericTransformStreamMixin, TransformStreamImpl, createReadableStreamProxy, type TransformerRecord,
  type TransformStreamDefaultControllerImpl,
} from './transform-stream';
export {
  WritableStreamImpl, type UnderlyingSink, type WritableStreamDefaultControllerImpl,
} from './writable-stream';

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
