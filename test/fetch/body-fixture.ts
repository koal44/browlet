import { expect, vi } from 'vitest';
import { FetchBody } from '../../src/fetch/body';
import type { TaskSourceKey } from '../../src/infra/tasks';
import { ParallelQueue } from '../../src/infra/parallel-queue';
import { createTestContext } from '../browlet/streams/environment';
import { ReadableStreamImpl } from '../../src/streams/index';
import { createClientEnvironment } from './client-fixture';

export function createBodyFixture() {
  const context = createTestContext();
  const tasks: { global: object; steps: () => void; }[] = [];
  const parallelSteps: (() => void)[] = [];
  const queueGlobalFetchTask = vi.fn((global: object, steps: () => void) => { tasks.push({ global, steps }); });
  const client = createClientEnvironment(undefined, context.getEnvironment());
  const env = {
    ...client,
    runInParallel: vi.fn((steps: () => void) => { parallelSteps.push(steps); }),
    queueTask(source: TaskSourceKey, steps: () => void) {
      expect(source).toBe('network');
      const task = { global: context.realm.globalObject, steps };
      tasks.push(task);
      return {
        remove() {
          const index = tasks.indexOf(task);
          if (index !== -1) tasks.splice(index, 1);
        },
      };
    },
    queueGlobalFetchTask,
  };
  return {
    context,
    env,
    queueGlobalFetchTask,
    tasks,
    parallelSteps,
    global: context.realm.globalObject,
    createBody: (chunks: unknown[] = []) => {
      const stream = ReadableStreamImpl.createDefault(undefined, undefined, 1, () => 1, env);
      for (const chunk of chunks) stream.enqueueChunk(chunk);
      return new FetchBody(stream, env);
    },
    createParallelQueue: () => new ParallelQueue(env.runInParallel),
    runTask: () => tasks.shift()!.steps(),
    runParallel: () => parallelSteps.shift()!(),
  };
}

export function readBodyBytes(body: FetchBody): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    body.stream.getDefaultReader().readAllBytes(resolve, reject);
  });
}
