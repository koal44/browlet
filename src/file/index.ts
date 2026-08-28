import type { Definition } from '../web-idl/declaration/index';
import {
  blobIDL, blobPartIDL, blobPropertyBagIDL, endingTypeIDL,
} from './blob';

export {
  blobIDL, blobPartIDL, blobPropertyBagIDL, BlobImpl,
  convertLineEndingsToNative, endingTypeIDL, getBlobStream, processBlobParts,
  readBlobBytes, sliceBlob, type BlobPart, type BlobPropertyBag,
  type BlobSerializationState, type EndingType,
} from './blob';
export {
  BlobData, BlobReadFailure, type BlobByteSource,
  type BlobReadFailureReason, type BlobSnapshotState,
} from './blob-data';
export {
  fileEnvironment, fileHost, getFileEnvironment, type BlobEnvironment,
  type FileEnvironment, type FileHost, type NativeLineEnding,
} from './environment';

export const fileIDLDefinitions: readonly Definition[] = [
  endingTypeIDL,
  blobPropertyBagIDL,
  blobPartIDL,
  blobIDL,
];
