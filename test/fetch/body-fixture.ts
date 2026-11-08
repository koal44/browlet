import { expect, vi } from 'vitest';
import { FetchBody } from '../../src/fetch/body';
import type { TaskRecord, TaskSourceKey } from '../../src/infra/tasks';
import { ParallelQueue } from '../../src/infra/parallel-queue';
import { createTestContext } from '../browlet/streams/environment';
import { ReadableStreamImpl } from '../../src/streams/index';
import { createClientEnvironment } from './client-fixture';

export function createBodyFixture() {
  const context = createTestContext();
  const tasks: (TaskRecord & { global: object; })[] = [];
  const parallelSteps: (() => void)[] = [];
  const queueGlobalFetchTask = vi.fn((global: object, task: TaskRecord) => {
    const queuedTask = { global, ...task };
    tasks.push(queuedTask);
    return {
      remove() {
        const index = tasks.indexOf(queuedTask);
        if (index === -1) return;
        tasks.splice(index, 1);
        queuedTask.discard?.();
      },
    };
  });
  const client = createClientEnvironment(undefined, context.getEnvironment());
  const env = {
    ...client,
    runInParallel: vi.fn((steps: () => void) => { parallelSteps.push(steps); }),
    queueTask(source: TaskSourceKey, task: TaskRecord) {
      expect(source).toBe('network');
      const queuedTask = { global: context.realm.globalObject, ...task };
      tasks.push(queuedTask);
      return {
        remove() {
          const index = tasks.indexOf(queuedTask);
          if (index === -1) return;
          tasks.splice(index, 1);
          queuedTask.discard?.();
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
    runTask: () => tasks.shift()!.run(),
    runParallel: () => parallelSteps.shift()!(),
  };
}

export function readBodyBytes(body: FetchBody): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    body.stream.getDefaultReader().readAllBytes(resolve, reject);
  });
}
