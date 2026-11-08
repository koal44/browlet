import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetch } from '../../src/fetch/fetch';
import { FetchBody } from '../../src/fetch/body';
import { FetchHeaders } from '../../src/fetch/headers';
import { FetchRequest } from '../../src/fetch/request';
import { FetchResponse } from '../../src/fetch/response';
import type { HTTPTransportListener, HTTPUploadSource } from '../../src/fetch/transport';
import { obtainURLOrigin } from '../../src/url/url';
import { ReadableStreamImpl } from '../../src/streams/index';
import { idlType } from '../../src/web-idl/core/index';
import { mockHTTPTransport } from '../fetch/transport-fixture';
import { createFetchWindow } from './fetch-fixture';

afterEach(() => vi.restoreAllMocks());

describe('Fetch execution-owner teardown', () => {
  it('cancels transport before headers when only its execution Document is destroyed', async () => {
    const f = fixture();
    const owner = createFetchWindow(f.clientEnv.userAgent);
    const response = vi.fn();
    const consumed = vi.fn();
    const completed = vi.fn();
    const controller = fetch(f.request, {
      processResponse: response, processResponseConsumeBody: consumed, processResponseEndOfBody: completed,
    }, owner.context.getEnvironment());
    const drain = (): void => { while (owner.runTask() || f.runTask()) { /* Advance both owners. */ } };
    await vi.waitFor(() => { drain(); expect(f.listener()).toBeDefined(); });
    expect(owner.networkingTasks()).toHaveLength(0);
    owner.queueTask(() => owner.document!.destroy());
    drain();
    await vi.waitFor(() => { drain(); expect(f.request.done).toBe(true); });
    expect(controller.state).toBe('terminated');
    expect(response).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }));
    expect(consumed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }), 'failure');
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }));
    expect(f.document.isFullyActive()).toBe(true);
    f.listener()!.onHeaders(200, 'OK', new FetchHeaders(), false);
    f.listener()!.onData(Uint8Array.of(1));
    f.listener()!.onEnd();
    await new Promise<void>((resolve) => setImmediate(resolve));
    drain();
    expect(response).toHaveBeenCalledOnce();
    expect(completed).toHaveBeenCalledOnce();
  });

  it('releases a completed Fetch before its execution Document is destroyed', async () => {
    const f = fixture();
    const owner = createFetchWindow(f.clientEnv.userAgent);
    const response = vi.fn();
    const controller = fetch(f.request, { processResponse: response }, owner.context.getEnvironment());
    const drain = (): void => { while (owner.runTask() || f.runTask()) { /* Advance both owners. */ } };
    await vi.waitFor(() => { drain(); expect(f.listener()).toBeDefined(); });
    f.listener()!.onHeaders(204, 'No Content', new FetchHeaders(), false);
    f.listener()!.onEnd();
    await vi.waitFor(() => { drain(); expect(f.request.done).toBe(true); });
    owner.queueTask(() => owner.document!.destroy());
    drain();
    expect(controller.state).toBe('ongoing');
    expect(controller.responseDeliveryCanceled).toBe(false);
    expect(response).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 204 }));
  });

  it.each([
    ['request preparation', 0, false], ['cache lookup', 1, false], ['network dispatch', 2, false],
    ['aborted request preparation', 0, true],
  ] as const)('finishes discarded %s without starting transport', async (_phase, completedTasks, aborted) => {
    const f = fixture('client');
    const response = vi.fn();
    const consumed = vi.fn();
    const completed = vi.fn();
    const controller = fetch(f.request, {
      processResponse: response, processResponseConsumeBody: consumed, processResponseEndOfBody: completed,
    }, f.env);
    // Advance the real HTTP preparation tasks, leaving the selected operation queued.
    for (let index = 0; index <= completedTasks; index++) {
      await vi.waitFor(() => expect(f.networkingTasks()).toHaveLength(1));
      if (index < completedTasks) expect(f.runTask()).toBe(true);
    }
    if (aborted) controller.abort('retained reason', f.env);
    const reason = controller.serializedAbortReason;
    f.realm.agent.eventLoop.removeTasksForDocument(f.document);
    await vi.waitFor(() => { f.drain(); expect(f.request.done).toBe(true); });
    expect(f.transport).not.toHaveBeenCalled();
    expect(controller.state).toBe(aborted ? 'aborted' : 'terminated');
    expect(controller.serializedAbortReason).toBe(reason);
    expect(response).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error', aborted }));
    expect(consumed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }), 'failure');
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }));
    expect(controller.hasPendingDelivery).toBe(false);
  });

  it('waits for an inactive execution Document to reactivate before preparing its request', async () => {
    const f = fixture('client');
    const browsingContext = f.document.browsingContext;
    f.document.browsingContext = null;
    f.document.notifyFullyActiveStateChanged();
    const response = vi.fn();
    const controller = fetch(f.request, { processResponse: response }, f.env);
    await vi.waitFor(() => expect(f.networkingTasks()).toHaveLength(1));
    expect(f.runTask()).toBe(false);
    expect(f.transport).not.toHaveBeenCalled();
    expect(controller.state).toBe('ongoing');
    f.document.browsingContext = browsingContext;
    f.document.notifyFullyActiveStateChanged();
    await vi.waitFor(() => { f.drain(); expect(f.listener()).toBeDefined(); });
    f.listener()!.onHeaders(204, 'No Content', new FetchHeaders(), false);
    f.listener()!.onEnd();
    await vi.waitFor(() => { f.drain(); expect(f.request.done).toBe(true); });
    expect(response).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 204 }));
    expect(controller.state).toBe('ongoing');
  });

  it('finishes preparation queued after execution-Document destruction with its separate client still active', async () => {
    const f = fixture();
    const owner = createFetchWindow(f.clientEnv.userAgent);
    const env = owner.context.getEnvironment();
    const response = vi.fn();
    const drain = (): void => { while (owner.runTask() || f.runTask()) { /* Both owning loops remain explicit. */ } };
    const controller = fetch(f.request, { processResponse: response }, env);
    owner.queueTask(() => owner.document!.destroy());
    expect(owner.runTask()).toBe(true);
    await vi.waitFor(() => { drain(); expect(f.request.done).toBe(true); });
    expect(f.transport).not.toHaveBeenCalled();
    expect(controller.state).toBe('terminated');
    expect(response).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }));
    expect(f.document.isFullyActive()).toBe(true);
  });

  it('finishes a pending preload at execution-Document destruction and discards its later response', async () => {
    const f = fixture();
    const owner = createFetchWindow(f.clientEnv.userAgent);
    const env = owner.context.getEnvironment();
    let receive!: (response: FetchResponse) => void;
    vi.spyOn(f.clientEnv, 'consumePreloadedResource').mockImplementation((_url, _destination, _mode, _credentials, _integrity, deliver) => {
      receive = deliver;
      return true;
    });
    const response = vi.fn();
    const controller = fetch(f.request, { processResponse: response }, env);
    // Start waiting for the preload, without any execution-owner task to discard.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(owner.networkingTasks()).toHaveLength(0);
    owner.queueTask(() => owner.document!.destroy());
    expect(owner.runTask()).toBe(true);
    const drain = (): void => { while (owner.runTask() || f.runTask()) { /* Both owning loops remain explicit. */ } };
    await vi.waitFor(() => { drain(); expect(f.request.done).toBe(true); });
    expect(response).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }));
    const preload = new FetchResponse();
    const discard = preload.discardBody = vi.fn();
    receive(preload.filter('basic'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    drain();
    expect(response).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }));
    expect(discard).toHaveBeenCalledOnce();
    expect(controller.state).toBe('terminated');
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.document.isFullyActive()).toBe(true);
  });

  it('finishes a discarded response handoff instead of delivering its queued success', async () => {
    const f = fixture('client');
    const response = vi.fn();
    const consumed = vi.fn();
    const completed = vi.fn();
    const controller = fetch(f.request, {
      processResponse: response, processResponseConsumeBody: consumed, processResponseEndOfBody: completed,
    }, f.env);
    await vi.waitFor(() => { f.drain(); expect(f.listener()).toBeDefined(); });
    // Destruction precedes the handoff, but the response has already been received.
    f.queueTask(() => f.document.destroy());
    f.listener()!.onHeaders(200, 'OK', new FetchHeaders(), false);
    await vi.waitFor(() => expect(f.networkingTasks()).toHaveLength(2));
    f.drain();
    await vi.waitFor(() => { f.drain(); expect(f.request.done).toBe(true); });
    expect(controller.state).toBe('terminated');
    expect(response).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }));
    expect(consumed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }), 'failure');
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }));
    expect(controller.hasPendingDelivery).toBe(false);
  });

  it('finishes a manual redirect when its queued body replay is discarded', async () => {
    const f = fixture('client');
    f.request.mode = 'navigate';
    f.request.destination = 'document';
    f.request.redirectMode = 'manual';
    f.request.method = 'POST';
    f.request.body = Uint8Array.of(1);
    const response = vi.fn();
    const controller = fetch(f.request, { processResponse: response }, f.env);
    await vi.waitFor(() => { f.drain(); expect(f.listener()).toBeDefined(); });
    f.listener()!.onHeaders(307, 'Temporary Redirect', new FetchHeaders([['Location', '/next']]), false);
    f.listener()!.onEnd();
    await vi.waitFor(() => { f.drain(); expect(response).toHaveBeenCalledOnce(); });
    controller.processNextManualRedirect();
    await vi.waitFor(() => expect(f.networkingTasks()).toHaveLength(1));
    f.realm.agent.eventLoop.removeTasksForDocument(f.document);
    await vi.waitFor(() => { f.drain(); expect(response).toHaveBeenCalledTimes(2); });
    expect(response).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'error' }));
    expect(controller.state).toBe('terminated');
    expect(f.transport).toHaveBeenCalledOnce();
    expect(f.request.urlList).toHaveLength(1);
  });

  it.each(['pending', 'queued'] as const)('cleans up a %s read on a destroyed execution Window while its separate client remains active', async (state) => {
    const f = fixture();
    const owner = createFetchWindow(f.clientEnv.userAgent);
    const env = owner.context.getEnvironment();
    const uploadStream = ReadableStreamImpl.createWithByteReadingSupport(undefined, undefined, 0, env);
    f.request.method = 'POST';
    f.request.body = new FetchBody(uploadStream, env);
    const response = vi.fn();
    const controller = fetch(f.request, { processResponse: response }, env);
    const drain = (): void => { while (owner.runTask() || f.runTask()) { /* Both HTML loops remain explicit. */ } };
    await vi.waitFor(() => { drain(); expect(f.listener()).toBeDefined(); });
    f.listener()!.onHeaders(200, 'OK', new FetchHeaders(), false);
    await vi.waitFor(() => { drain(); expect(response).toHaveBeenCalledOnce(); });
    const body = (response.mock.calls[0]![0] as FetchResponse).body!;
    const uploaded = vi.fn();
    const failed = vi.fn();
    const chunk = vi.fn();
    const upload = f.transport.mock.calls[0]![0].body as HTTPUploadSource;
    upload.read().observe(uploaded, uploaded);
    owner.queueTask(() => body.stream.getDefaultReader().readChunk({
      chunkSteps: chunk, closeSteps: chunk, errorSteps: failed,
    }));
    drain();
    expect(uploadStream.locked).toBe(true);
    owner.queueTask(() => owner.document!.destroy());
    if (state === 'queued') f.listener()!.onData(Uint8Array.of(1, 2));
    drain();
    await vi.waitFor(() => { drain(); expect(f.request.done).toBe(true); });
    await vi.waitFor(() => expect(uploaded).toHaveBeenCalledExactlyOnceWith(null));
    expect(uploadStream.locked).toBe(false);
    expect(body.stream.isErrored).toBe(true);
    expect(failed).toHaveBeenCalledOnce();
    expect(chunk).not.toHaveBeenCalled();
    expect(controller.state).toBe('terminated');
    expect(f.document.isFullyActive()).toBe(true);
  });

  it.each(['pending', 'queued'] as const)('fails a %s network read when its execution Document is destroyed', async (state) => {
    const f = fixture('client');
    const response = vi.fn();
    fetch(f.request, { processResponse: response }, f.env);
    await vi.waitFor(() => { f.drain(); expect(f.listener()).toBeDefined(); });
    f.listener()!.onHeaders(200, 'OK', new FetchHeaders(), false);
    await vi.waitFor(() => { f.drain(); expect(response).toHaveBeenCalledOnce(); });
    const body = (response.mock.calls[0]![0] as FetchResponse).body!;
    const chunk = vi.fn();
    const closed = vi.fn();
    const failed = vi.fn();
    f.queueTask(() => body.stream.getDefaultReader().readChunk({
      chunkSteps: chunk, closeSteps: closed, errorSteps: failed,
    }));
    f.drain();
    f.queueTask(() => f.document.destroy());
    if (state === 'queued') f.listener()!.onData(Uint8Array.of(1, 2));
    f.drain();
    expect(body.stream.isErrored).toBe(true);
    expect(failed).toHaveBeenCalledOnce();
    expect(chunk).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    await vi.waitFor(() => { f.drain(); expect(f.request.done).toBe(true); });
  });

  it.each(['abort', 'destroy'] as const)('releases an acquired upload reader on Document %s', async (operation) => {
    const f = fixture('client');
    const cancel = vi.fn(() => f.env.InternalPromise.resolve(undefined, idlType.undefined));
    const stream = ReadableStreamImpl.createWithByteReadingSupport(undefined, cancel, 0, f.env);
    f.request.method = 'POST';
    f.request.body = new FetchBody(stream, f.env);
    fetch(f.request, {}, f.env);
    await vi.waitFor(() => { f.drain(); expect(f.listener()).toBeDefined(); });
    const result = vi.fn();
    const upload = f.transport.mock.calls[0]![0].body as HTTPUploadSource;
    upload.read().observe(result, result);
    f.drain();
    expect(stream.locked).toBe(true);
    f.queueTask(() => f.document[operation]());
    f.drain();
    expect(stream.locked).toBe(false);
    await vi.waitFor(() => expect(result).toHaveBeenCalledExactlyOnceWith(null));
    // Ordinary abortion cancels the source on its task. Discard during destruction
    // releases the internal reader without invoking a potentially scripted source.
    expect(cancel).toHaveBeenCalledTimes(operation === 'abort' ? 1 : 0);
  });

  it('settles queued and later upload reads without starting them after destruction', async () => {
    const f = fixture('client');
    const stream = ReadableStreamImpl.createWithByteReadingSupport(undefined, undefined, 0, f.env);
    f.request.method = 'POST';
    f.request.body = new FetchBody(stream, f.env);
    fetch(f.request, {}, f.env);
    await vi.waitFor(() => { f.drain(); expect(f.listener()).toBeDefined(); });
    const upload = f.transport.mock.calls[0]![0].body as HTTPUploadSource;
    const pending = vi.fn();
    f.queueTask(() => f.document.destroy());
    upload.read().observe(pending, pending);
    f.drain();
    await vi.waitFor(() => expect(pending).toHaveBeenCalledExactlyOnceWith(null));
    const later = vi.fn();
    upload.read().observe(later, later);
    f.drain();
    await vi.waitFor(() => expect(later).toHaveBeenCalledExactlyOnceWith(null));
    expect(stream.disturbed).toBe(false);
    expect(stream.locked).toBe(false);
  });
});

describe('Fetch callback task cleanup', () => {
  it('finishes a response arriving after its client Document is destroyed on another loop', async () => {
    const f = fixture();
    const response = vi.fn();
    const consumed = vi.fn();
    const completed = vi.fn(() => {
      const task = f.realm.agent.eventLoop.currentlyRunningTask;
      expect(task).not.toBeNull();
      expect(task!.document).toBeNull();
    });
    f.queueTask(() => f.document.destroy());
    const controller = fetch(f.request, {
      processResponse: response,
      processResponseConsumeBody: consumed,
      processResponseEndOfBody: completed,
    }, f.env);
    await vi.waitFor(() => expect(f.listener()).toBeDefined());
    f.runTask();
    await vi.waitFor(() => {
      f.drain();
      expect(f.request.done).toBe(true);
    });
    expect(response).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }));
    expect(consumed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }), 'failure');
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }));
    expect(controller.hasPendingDelivery).toBe(false);
    expect(f.networkingTasks()).toHaveLength(0);
  });

  it('retains ordinary delivery for an inactive Document until it becomes active again', async () => {
    const f = fixture();
    const browsingContext = f.document.browsingContext;
    f.document.browsingContext = null;
    f.document.notifyFullyActiveStateChanged();
    const response = vi.fn();
    const controller = fetch(f.request, { processResponse: response }, f.env);
    await vi.waitFor(() => expect(f.listener()).toBeDefined());
    f.listener()!.onHeaders(204, 'No Content', new FetchHeaders(), false);
    f.listener()!.onEnd();
    await vi.waitFor(() => expect(f.networkingTasks()).toHaveLength(2));
    f.drain();
    expect(response).not.toHaveBeenCalled();
    expect(f.request.done).toBe(false);
    f.document.browsingContext = browsingContext;
    f.document.notifyFullyActiveStateChanged();
    f.drain();
    expect(response).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 204 }));
    expect(f.request.done).toBe(true);
    expect(controller.hasPendingDelivery).toBe(false);
  });

  it('removes queued upload progress and completion without removing unrelated tasks', async () => {
    const f = fixture();
    const progress = vi.fn();
    const uploaded = vi.fn();
    const unrelated = vi.fn();
    f.request.method = 'POST';
    f.request.body = Uint8Array.of(1, 2, 3, 4);
    const controller = fetch(f.request, {
      processRequestBodyChunkLength: progress,
      processRequestEndOfBody: uploaded,
    }, f.env);
    await vi.waitFor(() => expect(f.listener()).toBeDefined());
    f.listener()!.onRequestBodyChunkLength!(4);
    f.listener()!.onRequestEnd!();
    const queued = f.networkingTasks();
    expect(queued).toHaveLength(2);
    f.queueTask(unrelated);
    expect(f.clientEnv.fetchGroup.cancel()).toBe(true);
    expect(f.networkingTasks().some((task) => queued.includes(task))).toBe(false);
    f.drain();
    expect(progress).not.toHaveBeenCalled();
    expect(uploaded).not.toHaveBeenCalled();
    expect(unrelated).toHaveBeenCalledOnce();
    expect(controller.state).toBe('terminated');
  });

  it.each(['cancel', 'discard', 'cancel then discard'] as const)('completes queued response, null-body, and end-of-body callbacks once on %s', async (operation) => {
    const f = fixture();
    const response = vi.fn();
    const consumed = vi.fn();
    const completed = vi.fn();
    const controller = fetch(f.request, {
      processResponse: response,
      processResponseConsumeBody: consumed,
      processResponseEndOfBody: completed,
    }, f.env);
    await vi.waitFor(() => expect(f.listener()).toBeDefined());
    f.listener()!.onHeaders(204, 'No Content', new FetchHeaders(), false);
    f.listener()!.onEnd();
    await vi.waitFor(() => expect(f.networkingTasks()).toHaveLength(3));
    const queued = f.networkingTasks();
    expect(f.request.done).toBe(false);
    if (operation !== 'discard') {
      f.clientEnv.fetchGroup.cancel();
      expect(f.networkingTasks().some((task) => queued.includes(task))).toBe(false);
      expect(response).not.toHaveBeenCalled();
      expect(consumed).not.toHaveBeenCalled();
    }
    if (operation === 'cancel') f.drain();
    else f.realm.agent.eventLoop.removeTasksForDocument(f.document);
    expect(f.request.done).toBe(true);
    expect(response).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }));
    expect(consumed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 204 }), 'failure');
    expect(completed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error' }));
    expect(controller.hasPendingDelivery).toBe(false);
    expect(f.networkingTasks()).toHaveLength(0);
  });

  it('cancels null-body delivery after completion on a parallel destination', async () => {
    const f = fixture();
    const response = vi.fn();
    const consumed = vi.fn();
    const completed = vi.fn(() => {
      expect(f.request.done).toBe(true);
      expect(f.clientEnv.fetchGroup.cancel()).toBe(true);
    });
    const controller = fetch(f.request, {
      useParallelQueue: true,
      processResponse: response,
      processResponseConsumeBody: consumed,
      processResponseEndOfBody: completed,
    }, f.env);
    await vi.waitFor(() => expect(f.listener()).toBeDefined());
    f.listener()!.onHeaders(204, 'No Content', new FetchHeaders(), false);
    f.listener()!.onEnd();
    await vi.waitFor(() => expect(consumed).toHaveBeenCalledOnce());
    expect(response).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 204 }));
    expect(completed).toHaveBeenCalledOnce();
    expect(consumed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 204 }), 'failure');
    expect(controller.hasPendingDelivery).toBe(false);
    expect(f.networkingTasks()).toHaveLength(0);
  });
});

function fixture(executionOwner: 'sandbox' | 'client' = 'sandbox') {
  const f = createFetchWindow();
  const document = f.document!;
  const clientEnv = f.context.getEnvironment();
  const env = executionOwner === 'client' ? clientEnv : clientEnv.userAgent.sandbox;
  const request = new FetchRequest(clientEnv.parseURL('https://example.test/resource')!, env);
  request.client = clientEnv;
  document.origin = obtainURLOrigin(request.url);
  request.mode = 'same-origin';
  request.cacheMode = 'no-store';
  let listener: HTTPTransportListener | undefined;
  const transport = mockHTTPTransport(clientEnv.userAgent, (_request, value) => { listener = value; });
  return {
    ...f, document, clientEnv, env, request, transport,
    listener: () => listener,
    drain: () => { while (f.runTask()) { /* Advance the actual destination loop. */ } },
  };
}
