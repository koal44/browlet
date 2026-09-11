import { vi } from 'vitest';
import { BodyRecord } from '../../src/fetch/body';
import { ParallelQueue } from '../../src/infra/parallel-queue';
import { createTestContext } from '../browlet/streams/environment';
import { ReadableStreamImpl } from '../../src/streams/index';

export function createBodyFixture() {
  const context = createTestContext();
  const tasks: { global: object; steps: () => void; }[] = [];
  const parallelSteps: (() => void)[] = [];
  const scheduling = {
    queueGlobalTask: vi.fn((global: object, steps: () => void) => { tasks.push({ global, steps }); }),
    runInParallel: vi.fn((steps: () => void) => { parallelSteps.push(steps); }),
  };
  const runtime = { ...context.getRuntime(), networking: scheduling };
  return {
    context,
    runtime,
    scheduling,
    tasks,
    parallelSteps,
    global: context.realm.global,
    createBody: (chunks: readonly unknown[] = []) => {
      const stream = ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, runtime);
      for (const chunk of chunks) stream.enqueueChunk(chunk);
      return new BodyRecord(stream, runtime);
    },
    createParallelQueue: () => new ParallelQueue(scheduling.runInParallel),
    runTask: () => tasks.shift()!.steps(),
    runParallel: () => parallelSteps.shift()!(),
  };
}

export function readBodyBytes(body: BodyRecord): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    body.stream.getDefaultReader().readAllBytes(resolve, reject);
  });
}
