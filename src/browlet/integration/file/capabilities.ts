import type { CapabilityRegistration } from '../../../web-idl/capability';
import { blobSerializableCapabilities } from './structured-data/blob';
import { fileSerializableCapabilities } from './structured-data/file';
import {
  fileListSerializableCapabilities,
} from './structured-data/file-list';

export const fileCapabilities = [
  ...blobSerializableCapabilities,
  ...fileSerializableCapabilities,
  ...fileListSerializableCapabilities,
] satisfies CapabilityRegistration[];
