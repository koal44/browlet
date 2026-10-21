import type { Definition } from '../web-idl/core/index';

import type { FileEnvironment } from './environment';
import {
  blobIDL, blobPartIDL, blobPropertyBagIDL, endingTypeIDL,
} from './blob';
import { fileIDL, filePropertyBagIDL } from './file';
import { fileListIDL } from './file-list';

/** File API declarations supplied to the host binding. */
export const fileIDLDefinitions: Definition<FileEnvironment>[] = [
  endingTypeIDL,
  blobPropertyBagIDL,
  blobPartIDL,
  blobIDL,
  filePropertyBagIDL,
  fileIDL,
  fileListIDL,
];
