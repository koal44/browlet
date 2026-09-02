import type { Definition } from '../web-idl/declaration/index';
import {
  blobIDL, blobPartIDL, blobPropertyBagIDL, endingTypeIDL,
} from './blob';
import { fileIDL, filePropertyBagIDL } from './file';
import { fileListIDL } from './file-list';

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
  fileClockHost, fileHost, type FileClockHost, type FileHost,
  type NativeLineEnding,
} from './environment';
export {
  createFileFromHost, fileIDL, FileImpl, filePropertyBagIDL,
  type FilePropertyBag, type FileSerializationState, type HostFileMetadata,
} from './file';
export { fileListIDL, FileListImpl } from './file-list';

export const fileIDLDefinitions: readonly Definition[] = [
  endingTypeIDL,
  blobPropertyBagIDL,
  blobPartIDL,
  blobIDL,
  filePropertyBagIDL,
  fileIDL,
  fileListIDL,
];
