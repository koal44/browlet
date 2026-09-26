import { vi } from 'vitest';
import { FetchBody } from '../../src/fetch/body';
import { ParallelQueue } from '../../src/infra/parallel-queue';
import { queueNetworkingTask } from '../../src/js-engine/index';
import { createTestContext } from '../browlet/streams/environment';
import { ReadableStreamImpl } from '../../src/streams/index';

export function createBodyFixture() {
  const context = createTestContext();
  const tasks: { global: object; steps: () => void; }[] = [];
  const parallelSteps: (() => void)[] = [];
  const scheduling = {
    queueGlobalTask: vi.fn((global: object, steps: () => void) => { tasks.push({ global, steps }); }),
  };
  const env = {
    queueNetworkingTask,
    exec: {
      ...context.getEnvironment().exec,
      runInParallel: vi.fn((steps: () => void) => { parallelSteps.push(steps); }),
      networking: scheduling,
    },
  };
  return {
    context,
    env,
    scheduling,
    tasks,
    parallelSteps,
    global: context.realm.global,
    createBody: (chunks: unknown[] = []) => {
      const stream = ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, env);
      for (const chunk of chunks) stream.enqueueChunk(chunk);
      return new FetchBody(stream, env);
    },
    createParallelQueue: () => new ParallelQueue(env.exec.runInParallel),
    runTask: () => tasks.shift()!.steps(),
    runParallel: () => parallelSteps.shift()!(),
  };
}

export function readBodyBytes(body: FetchBody): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    body.stream.getDefaultReader().readAllBytes(resolve, reject);
  });
}
