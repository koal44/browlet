import type { FetchStructuredData, FetchTaskScheduling, QueueGlobalFetchTask } from '../../fetch/index';
import {
  structuredDeserialize,
} from '../scripting/structured-data/deserialize';
import type {
  StructuredDataEnvironment,
} from '../scripting/structured-data/environment';
import type { SerializedRecord } from '../scripting/structured-data/records';
import { structuredSerialize } from '../scripting/structured-data/serialize';
import { networkingTaskSource, queueGlobalTask } from '../scripting/tasks';
import { runInParallel } from './scripting';

export function createFetchStructuredData(
  environment: StructuredDataEnvironment,
): FetchStructuredData {
  return {
    serialize: (value) => structuredSerialize(value, environment),
    // Fetch only retains these records; HTML owns their concrete shape.
    deserialize: (record) => structuredDeserialize(
      record as SerializedRecord,
      environment,
    ),
  };
}

export const queueGlobalFetchTask: QueueGlobalFetchTask = (global, steps) => {
  queueGlobalTask(networkingTaskSource, global, steps);
};

export const fetchTaskScheduling: FetchTaskScheduling = {
  queueGlobalTask: queueGlobalFetchTask,
  runInParallel,
};
