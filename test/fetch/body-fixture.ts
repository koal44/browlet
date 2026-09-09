import { createReactions } from '../browlet/streams/implementation-fixture';
import { vi } from 'vitest';

import { BodyRecord } from '../../src/fetch/body';
import { ParallelQueue } from '../../src/infra/parallel-queue';
import {
  createReadableStream, enqueueReadableStream, getReadableStreamReader, readAllBytes,
} from '../../src/streams/index';
import { createTestContext } from '../browlet/streams/environment';

export function createBodyFixture() {
  const context = createTestContext();
  const tasks: { global: object; steps: () => void; }[] = [];
  const parallelSteps: (() => void)[] = [];
  const scheduling = {
    queueGlobalTask: vi.fn((global: object, steps: () => void) => { tasks.push({ global, steps }); }),
    runInParallel: vi.fn((steps: () => void) => { parallelSteps.push(steps); }),
  };
  return {
    context,
    scheduling,
    tasks,
    parallelSteps,
    global: context.realm.global,
    createBody: (chunks: readonly unknown[] = []) => {
      const stream = createReadableStream(undefined, undefined, 1, () => 1, createReactions());
      for (const chunk of chunks) enqueueReadableStream(stream, chunk);
      return new BodyRecord(stream, scheduling);
    },
    createParallelQueue: () => new ParallelQueue(scheduling.runInParallel),
    runTask: () => tasks.shift()!.steps(),
    runParallel: () => parallelSteps.shift()!(),
  };
}

export function readBodyBytes(body: BodyRecord): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    readAllBytes(getReadableStreamReader(body.stream), resolve, reject);
  });
}
