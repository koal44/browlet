import type { Definition } from '../web-idl/core/index';

import type { StreamsEnvironment } from './environment';
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

/** Streams declarations, callback dictionaries, and interface-mixin contributions. */
export const streamsIDLDefinitions: Definition<StreamsEnvironment>[] = [
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
