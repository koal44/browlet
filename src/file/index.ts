import type { Definition } from '../web-idl/core/index';

import type { FileEnvironment } from './environment';
import {
  blobIDL, blobPartIDL, blobPropertyBagIDL, endingTypeIDL,
} from './blob';
import { fileIDL, filePropertyBagIDL } from './file';
import { fileListIDL } from './file-list';

export {
  blobIDL, blobPartIDL, blobPropertyBagIDL, BlobImpl,
  convertLineEndingsToNative, endingTypeIDL,
  type BlobPart, type BlobPropertyBag,
  type BlobSerializationState, type EndingType,
} from './blob';
export {
  BlobData, BlobReadFailure, type BlobByteSource,
  type BlobReadFailureReason, type BlobSnapshotState,
} from './blob-data';
export {
  fileIDL, FileImpl, filePropertyBagIDL,
  type FilePropertyBag, type FileSerializationState, type HostFileMetadata,
} from './file';
export type { FileEnvironment, FileExecution } from './environment';
export { fileListIDL, FileListImpl } from './file-list';
export { packageData, type FileReadType } from './package-data';

export const fileIDLDefinitions: Definition<FileEnvironment>[] = [
  endingTypeIDL,
  blobPropertyBagIDL,
  blobPartIDL,
  blobIDL,
  filePropertyBagIDL,
  fileIDL,
  fileListIDL,
];
