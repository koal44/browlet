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
  fileReading, getFileReading, nativeLineEnding,
  type FileReadingCapability, type NativeLineEnding,
} from './integration';
export {
  createFileFromHost, fileIDL, FileImpl, filePropertyBagIDL,
  type FilePropertyBag, type FileSerializationState, type HostFileMetadata,
} from './file';
export { fileListIDL, FileListImpl } from './file-list';
export { packageData, type FileReadType } from './package-data';

export const fileIDLDefinitions: Definition[] = [
  endingTypeIDL,
  blobPropertyBagIDL,
  blobPartIDL,
  blobIDL,
  filePropertyBagIDL,
  fileIDL,
  fileListIDL,
];
