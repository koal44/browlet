import { describe, expect, it, vi } from 'vitest';
import { FetchController } from '../../src/fetch/controller';
import { FetchGroup, type DeferredFetchRecord } from '../../src/fetch/group';
import { createRequestRecord } from './record-fixture';

describe('Fetch groups', () => {
  it('terminates an empty group without invoking any deferred work', () => {
    expect(() => new FetchGroup().terminate()).not.toThrow();
  });

  it('terminates only unfinished, non-keepalive requests with controllers', () => {
    const group = new FetchGroup();
    const active = { request: createRequestRecord(), controller: new FetchController() };
    const done = { request: createRequestRecord(), controller: new FetchController() };
    const keepalive = { request: createRequestRecord(), controller: new FetchController() };
    done.request.done = true;
    keepalive.request.keepalive = true;
    group.fetchRecords.push(active, done, keepalive, { request: createRequestRecord(), controller: null });

    group.terminate();

    expect(active.controller.state).toBe('terminated');
    expect(done.controller.state).toBe('ongoing');
    expect(keepalive.controller.state).toBe('ongoing');
    expect(active.request.done).toBe(false);
  });

  it.each(['sent', 'aborted'] as const)('does not reprocess deferred requests in state %s', (invokeState) => {
    const group = new FetchGroup();
    const notifyInvoked = vi.fn();
    group.deferredFetchRecords.push({ request: createRequestRecord(), notifyInvoked, invokeState });

    expect(() => group.terminate()).not.toThrow();
    expect(notifyInvoked).not.toHaveBeenCalled();
  });

  it('leaves a pending deferred record intact when it reaches the unimplemented processing step', () => {
    const group = new FetchGroup();
    const record: DeferredFetchRecord = {
      request: createRequestRecord(), notifyInvoked: vi.fn(), invokeState: 'pending',
    };
    group.deferredFetchRecords.push(record);

    expect(() => group.terminate()).toThrow('Deferred fetch processing is not implemented');
    expect(record.invokeState).toBe('pending');
    expect(record.notifyInvoked).not.toHaveBeenCalled();
    expect(group.deferredFetchRecords).toEqual([record]);
  });
});
