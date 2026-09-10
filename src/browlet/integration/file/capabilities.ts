import { EOL as nodeLineEnding } from 'node:os';

import {
  blobIDL, nativeLineEnding, type NativeLineEnding,
} from '../../../file/index';
import type { CapabilityRegistration } from '../../../web-idl/capability';
import { blobSerializableCapabilities } from './structured-data/blob';
import { fileSerializableCapabilities } from './structured-data/file';
import {
  fileListSerializableCapabilities,
} from './structured-data/file-list';

export const fileCapabilities = [
  nativeLineEnding.for(blobIDL, normalizeNativeLineEnding(nodeLineEnding)),
  ...blobSerializableCapabilities,
  ...fileSerializableCapabilities,
  ...fileListSerializableCapabilities,
] satisfies CapabilityRegistration[];

function normalizeNativeLineEnding(value: string): NativeLineEnding {
  return value === '\r\n' ? '\r\n' : '\n';
}
