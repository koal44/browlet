import { describe, expect, it, vi } from 'vitest';
import { FetchController } from '../../src/fetch/controller';
import { FetchGroup, type DeferredFetchRecord } from '../../src/fetch/group';
import { createFetchRequest } from './fetch-fixture';

describe('Fetch groups', () => {
  it('cancels unfinished requests once without rewriting existing abort state', () => {
    const group = new FetchGroup();
    const active = { request: createFetchRequest(), controller: new FetchController() };
    const done = { request: createFetchRequest(), controller: new FetchController() };
    const aborted = { request: createFetchRequest(), controller: new FetchController() };
    done.request.done = true;
    done.request.keepalive = true;
    aborted.controller.state = 'aborted';
    const cancel = vi.fn();
    active.controller.addCancellationSteps(cancel);
    group.fetchRecords.push(active, done, aborted, { request: createFetchRequest(), controller: null });
    expect(group.cancel()).toBe(true);
    expect(active.controller.state).toBe('terminated');
    expect(aborted.controller.state).toBe('aborted');
    expect(done.controller.state).toBe('ongoing');
    expect(active.request.done).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(group.cancel()).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('snapshots selected requests so cancellation cannot take over a newly started fetch', () => {
    const group = new FetchGroup();
    const first = { request: createFetchRequest(), controller: new FetchController() };
    const next = { request: createFetchRequest(), controller: new FetchController() };
    first.controller.addCancellationSteps(() => group.fetchRecords.push(next));
    group.fetchRecords.push(first);
    expect(group.cancel()).toBe(true);
    expect(next.controller.state).toBe('ongoing');
    expect(group.cancel()).toBe(true);
    expect(next.controller.state).toBe('terminated');
  });

  it.each(['ongoing', 'aborted', 'terminated'] as const)('cancels retained body delivery after a %s request is done', (state) => {
    const group = new FetchGroup();
    const request = createFetchRequest();
    const controller = new FetchController();
    request.done = true;
    controller.state = state;
    const reason = controller.serializedAbortReason = { message: 'retained reason' };
    const cancel = vi.fn();
    controller.addDeliveryCancellationSteps(cancel);
    group.fetchRecords.push({ request, controller });
    expect(group.cancel()).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(controller.state).toBe(state === 'ongoing' ? 'terminated' : state);
    expect(controller.serializedAbortReason).toBe(reason);
    expect(controller.hasPendingDelivery).toBe(false);
    expect(group.cancel()).toBe(false);
  });

  it('preserves keepalive transport and delivery while canceling ordinary requests', () => {
    const group = new FetchGroup();
    const ordinary = { request: createFetchRequest(), controller: new FetchController() };
    const keepalive = { request: createFetchRequest(), controller: new FetchController() };
    keepalive.request.keepalive = true;
    const cancel = vi.fn();
    keepalive.controller.addDeliveryCancellationSteps(cancel);
    group.fetchRecords.push(ordinary, keepalive);
    expect(group.cancel()).toBe(true);
    expect(ordinary.controller.state).toBe('terminated');
    expect(keepalive.controller.state).toBe('ongoing');
    expect(keepalive.controller.responseDeliveryCanceled).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(group.cancel()).toBe(false);
  });

  it('leaves deferred requests with their invocation owner', () => {
    const group = new FetchGroup();
    const record: DeferredFetchRecord = {
      request: createFetchRequest(), notifyInvoked: vi.fn(), invokeState: 'pending',
    };
    group.deferredFetchRecords.push(record);
    expect(group.cancel()).toBe(false);
    expect(record.invokeState).toBe('pending');
    expect(record.notifyInvoked).not.toHaveBeenCalled();
  });

  it('counts pending completion even after termination, until Fetch marks the request done', () => {
    const group = new FetchGroup();
    const request = createFetchRequest();
    expect(group.hasPendingFetches()).toBe(false);
    group.fetchRecords.push({ request, controller: new FetchController() });
    expect(group.hasPendingFetches()).toBe(true);
    group.terminate();
    expect(group.hasPendingFetches()).toBe(true);
    request.done = true;
    expect(group.hasPendingFetches()).toBe(false);
  });

  it('counts unfinished requests without a controller, but not unsent deferred requests', () => {
    const group = new FetchGroup();
    group.deferredFetchRecords.push({ request: createFetchRequest(), notifyInvoked() {}, invokeState: 'pending' });
    expect(group.hasPendingFetches()).toBe(false);
    const request = createFetchRequest();
    request.keepalive = true;
    group.fetchRecords.push({ request, controller: null });
    expect(group.hasPendingFetches()).toBe(true);
    request.done = true;
    expect(group.hasPendingFetches()).toBe(false);
  });

  it('terminates an empty group without invoking any deferred work', () => {
    expect(() => new FetchGroup().terminate()).not.toThrow();
  });

  it('terminates only unfinished, non-keepalive requests with controllers', () => {
    const group = new FetchGroup();
    const active = { request: createFetchRequest(), controller: new FetchController() };
    const done = { request: createFetchRequest(), controller: new FetchController() };
    const keepalive = { request: createFetchRequest(), controller: new FetchController() };
    done.request.done = true;
    keepalive.request.keepalive = true;
    group.fetchRecords.push(active, done, keepalive, { request: createFetchRequest(), controller: null });

    group.terminate();

    expect(active.controller.state).toBe('terminated');
    expect(done.controller.state).toBe('ongoing');
    expect(keepalive.controller.state).toBe('ongoing');
    expect(active.request.done).toBe(false);
  });

  it.each(['sent', 'aborted'] as const)('does not reprocess deferred requests in state %s', (invokeState) => {
    const group = new FetchGroup();
    const notifyInvoked = vi.fn();
    group.deferredFetchRecords.push({ request: createFetchRequest(), notifyInvoked, invokeState });

    expect(() => group.terminate()).not.toThrow();
    expect(notifyInvoked).not.toHaveBeenCalled();
  });

  it('leaves a pending deferred record intact when it reaches the unimplemented processing step', () => {
    const group = new FetchGroup();
    const record: DeferredFetchRecord = {
      request: createFetchRequest(), notifyInvoked: vi.fn(), invokeState: 'pending',
    };
    group.deferredFetchRecords.push(record);

    expect(() => group.terminate()).toThrow('Deferred fetch processing is not implemented');
    expect(record.invokeState).toBe('pending');
    expect(record.notifyInvoked).not.toHaveBeenCalled();
    expect(group.deferredFetchRecords).toEqual([record]);
  });
});
