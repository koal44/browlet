import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';

import { fetchTaskScheduling } from '../../src/browlet/integration/fetch';
import { bytesAsBody } from '../../src/fetch/body';
import { createFetchWindow } from './fetch-fixture';
import { createPromiseReactions } from '../../src/js-engine/index';

describe('Fetch body delivery through HTML', () => {
  it('routes a foreign body to the destination Window networking tasks', async () => {
    const source = createFetchWindow();
    const target = createFetchWindow();
    const body = bytesAsBody(Uint8Array.of(1, 2), fetchTaskScheduling, createPromiseReactions(source.realm));
    const events: (number[] | string)[] = [];
    const error = vi.fn();
    body.incrementallyRead(
      (bytes) => events.push([...bytes]), () => events.push('end'), error,
      target.realm.global,
    );
    await nextTurn();
    expect(events).toEqual([]);
    expect(source.networkingTasks()).toHaveLength(0);
    expect(target.networkingTasks()).toHaveLength(1);
    expect(target.networkingTasks()[0]!.document).toBe(target.document);

    target.runTask();
    expect(events).toEqual([[1, 2]]);
    expect(target.networkingTasks()).toHaveLength(1);
    expect(target.networkingTasks()[0]!.document).toBe(target.document);
    target.runTask();
    expect(events).toEqual([[1, 2], 'end']);
    expect(error).not.toHaveBeenCalled();
  });

  it('fully reads on the stream realm checkpoint and queues completion as another task', async () => {
    const fixture = createFetchWindow();
    const body = bytesAsBody(Uint8Array.of(1, 2), fetchTaskScheduling, createPromiseReactions(fixture.realm));
    await nextTurn();
    const process = vi.fn();
    const error = vi.fn();
    fixture.queueTask(() => body.fullyRead(process, error, fixture.realm.global));

    fixture.runTask();
    expect(process).not.toHaveBeenCalled();
    expect(fixture.networkingTasks()).toHaveLength(1);
    expect(fixture.networkingTasks()[0]!.document).toBe(fixture.document);
    fixture.runTask();
    expect(process).toHaveBeenCalledExactlyOnceWith(Uint8Array.of(1, 2));
    expect(error).not.toHaveBeenCalled();
  });

  it('uses HTML parallel scheduling when no task destination is supplied', async () => {
    const fixture = createFetchWindow();
    const body = bytesAsBody(Uint8Array.of(1, 2), fetchTaskScheduling, createPromiseReactions(fixture.realm));
    const chunks: number[][] = [];
    const completed = new Promise<void>((resolve, reject) => {
      body.incrementallyRead((bytes) => chunks.push([...bytes]), resolve, reject);
    });
    expect(chunks).toEqual([]);
    await completed;
    expect(chunks).toEqual([[1, 2]]);
    expect(fixture.networkingTasks()).toHaveLength(0);
  });
});
