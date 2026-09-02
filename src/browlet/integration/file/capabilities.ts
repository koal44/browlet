import { EOL as nodeLineEnding } from 'node:os';

import {
  fileReading, nativeLineEnding, type NativeLineEnding,
} from '../../../file/index';
import type { CapabilityRegistration } from '../../../web-idl/capability';
import { windowIDL } from '../../browsing/window/window';
import {
  createTaskSource, runInParallel,
} from '../../scripting/event-loop';
import { queueGlobalTask } from '../../scripting/tasks';
import { blobSerializableCapabilities } from './structured-data/blob';
import { fileSerializableCapabilities } from './structured-data/file';
import {
  fileListSerializableCapabilities,
} from './structured-data/file-list';

export const fileCapabilities = [
  nativeLineEnding.for(windowIDL, normalizeNativeLineEnding(nodeLineEnding)),
  fileReading.for(windowIDL, {
    queueTask(global, steps) {
      queueGlobalTask(fileReadingTaskSource, global, steps);
    },
    runInParallel,
  }),
  ...blobSerializableCapabilities,
  ...fileSerializableCapabilities,
  ...fileListSerializableCapabilities,
] satisfies CapabilityRegistration[];

function normalizeNativeLineEnding(value: string): NativeLineEnding {
  return value === '\r\n' ? '\r\n' : '\n';
}

const fileReadingTaskSource = createTaskSource('file reading');
