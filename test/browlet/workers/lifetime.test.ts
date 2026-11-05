import { describe, expect, it, vi } from 'vitest';

import { StorageKey } from '../../../src/storage/index';
import { obtainURLOrigin, parseURL, type Origin, type URLRecord } from '../../../src/url/index';
import { EventSourceImpl, MessageChannelImpl, MessagePortImpl } from '../../../src/browlet/communication/index';
import { BrowsingContext, Navigable, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { HTMLIFrameElementImpl } from '../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { PolicyContainer } from '../../../src/browlet/browsing/policy/index';
import { SandboxEnvironment, WindowOrWorkerGlobalScopeMixin } from '../../../src/browlet/environment/index';
import {
  browletBindingWorld, createBrowletEnvironmentInit, createWindowEnvironment,
} from '../../../src/browlet/integration/web-idl/index';
import { AgentCluster, BrowletRealm, EventLoop, SandboxAgent, WindowAgent } from '../../../src/browlet/scripting/index';
import { UserAgent } from '../../../src/browlet/user-agent';
import { monotonicClock, type Moment } from '../../../src/timing/index';
import { DedicatedWorkerGlobalImpl, SharedWorkerGlobalImpl, WorkerGlobalImpl } from '../../../src/browlet/workers/index';
import type { MessageEvent, MessagePort } from '../../../src/browlet/platform';
import { createFetchRequest } from '../../fetch/fetch-fixture';

describe('Worker lifetime ownership (HTML §10.2.3)', () => {
  it('excludes disconnected ports and channels entirely within the worker', () => {
    const worker = createWorker();
    new MessagePortImpl(worker.env);
    new MessageChannelImpl(worker.env);
    expect(worker.global.ports).toEqual([]);
  });

  it('lists only the owned endpoint of each external channel and returns a fresh snapshot', () => {
    const first = createWorker();
    const second = createWorker();
    const firstPort = new MessagePortImpl(first.env);
    const secondPort = new MessagePortImpl(second.env);
    firstPort.entangle(secondPort);
    expect(first.global.ports).toEqual([firstPort]);
    expect(second.global.ports).toEqual([secondPort]);
    const snapshot = first.global.ports;
    snapshot.length = 0;
    expect(first.global.ports).toEqual([firstPort]);
  });

  it('includes a dedicated worker\'s implicit inside port once entangled', () => {
    const { env } = createWindow();
    const worker = createWorker();
    const global = worker.global as DedicatedWorkerGlobalImpl;
    const outside = new MessagePortImpl(env);
    expect(global.ports).toEqual([]);
    global.insidePort.entangle(outside);
    expect(global.ports).toEqual([global.insidePort]);
    outside.disentangle();
    expect(global.ports).toEqual([]);
  });

  it('includes each shared-worker connection independently of its queue being started', () => {
    const shared = createWorker('shared');
    const nested = createWorker();
    const window = createWindow();
    const first = new MessagePortImpl(shared.env);
    const second = new MessagePortImpl(shared.env);
    const windowPort = new MessagePortImpl(window.env);
    const workerPort = new MessagePortImpl(nested.env);
    first.entangle(windowPort);
    second.entangle(workerPort);
    second.start();
    expect(shared.global.ports).toEqual([first, second]);
    expect(nested.global.ports).toEqual([workerPort]);
    windowPort.close();
    expect(shared.global.ports).toEqual([second]);
  });

  it.each(['local', 'remote'])('removes both ends when the %s endpoint closes', (side) => {
    const first = createWorker();
    const second = createWorker();
    const local = new MessagePortImpl(first.env);
    const remote = new MessagePortImpl(second.env);
    local.entangle(remote);
    (side === 'local' ? local : remote).close();
    expect(first.global.ports).toEqual([]);
    expect(second.global.ports).toEqual([]);
  });

  it('updates membership when re-entanglement replaces a cross-global channel with a local one', () => {
    const first = createWorker();
    const second = createWorker();
    const local = new MessagePortImpl(first.env);
    const remote = new MessagePortImpl(second.env);
    local.entangle(remote);
    local.entangle(new MessagePortImpl(first.env));
    expect(first.global.ports).toEqual([]);
    expect(second.global.ports).toEqual([]);
  });

  it('follows completed transfers out of and back into the worker', () => {
    const first = createWorker();
    const second = createWorker();
    const channel = new MessageChannelImpl(first.env);
    const original = first.context.project(MessagePortImpl, channel.port2)!;
    expect(first.global.ports).toEqual([]);
    const serialized = first.env.serializeWithTransfer(original, [original]);
    const moved = second.env.deserializeWithTransfer(serialized).deserialized as MessagePort;
    const movedImpl = second.context.unwrap(moved, MessagePortImpl)!;
    expect(first.global.ports).toEqual([channel.port1]);
    expect(second.global.ports).toEqual([movedImpl]);

    first.env.deserializeWithTransfer(second.env.serializeWithTransfer(moved, [moved]));
    expect(first.global.ports).toEqual([]);
    expect(second.global.ports).toEqual([]);
  });

  it('keeps the connection and messages while its peer is in flight between globals', () => {
    const first = createWorker();
    const second = createWorker();
    const third = createWorker();
    const local = new MessagePortImpl(first.env);
    const remote = new MessagePortImpl(second.env);
    local.entangle(remote);
    local.postMessage('before', []);
    const platform = second.context.project(MessagePortImpl, remote)!;
    const serialized = second.env.serializeWithTransfer(platform, [platform]);
    expect(first.global.ports).toEqual([local]);
    expect(second.global.ports).toEqual([]);
    expect(third.global.ports).toEqual([]);
    // Closing the detached sender object must not close the endpoint being transported.
    remote.close();
    local.postMessage('during', []);
    expect(first.global.ports).toEqual([local]);
    const received: unknown[] = [];
    const moved = third.env.deserializeWithTransfer(serialized).deserialized as MessagePort;
    moved.onmessage = (event) => { received.push((event as MessageEvent).data); };
    local.postMessage('after', []);
    while (third.env.responsibleEventLoop.runTaskTurn()) { /* Deliver queued messages in the new realm. */ }
    expect(received).toEqual(['before', 'during', 'after']);
    expect(first.global.ports).toEqual([local]);
    expect(second.global.ports).toEqual([]);
    expect(third.global.ports).toEqual([third.context.unwrap(moved, MessagePortImpl)]);
  });

  it('counts an in-flight peer until it is received back into the same global', () => {
    const worker = createWorker();
    const channel = new MessageChannelImpl(worker.env);
    const platform = worker.context.project(MessagePortImpl, channel.port2)!;
    expect(worker.global.ports).toEqual([]);
    const serialized = worker.env.serializeWithTransfer(platform, [platform]);
    expect(worker.global.ports).toEqual([channel.port1]);
    worker.env.deserializeWithTransfer(serialized);
    expect(worker.global.ports).toEqual([]);
  });

  it('keeps a connection closed if the remaining endpoint closes while its peer is in flight', () => {
    const first = createWorker();
    const second = createWorker();
    const third = createWorker();
    const local = new MessagePortImpl(first.env);
    const remote = new MessagePortImpl(second.env);
    local.entangle(remote);
    const platform = second.context.project(MessagePortImpl, remote)!;
    const serialized = second.env.serializeWithTransfer(platform, [platform]);
    expect(first.global.ports).toEqual([local]);
    local.close();
    expect(first.global.ports).toEqual([]);
    third.env.deserializeWithTransfer(serialized);
    expect(first.global.ports).toEqual([]);
    expect(second.global.ports).toEqual([]);
    expect(third.global.ports).toEqual([]);
  });

  it.each(['same', 'different'] as const)('handles both endpoints in flight and receipt in %s globals', (destination) => {
    const sender = createWorker();
    const receiver = createWorker();
    const other = destination === 'same' ? receiver : createWorker();
    const channel = new MessageChannelImpl(sender.env);
    const first = sender.context.project(MessagePortImpl, channel.port1)!;
    const second = sender.context.project(MessagePortImpl, channel.port2)!;
    const firstTransfer = sender.env.serializeWithTransfer(first, [first]);
    const secondTransfer = sender.env.serializeWithTransfer(second, [second]);
    expect(sender.global.ports).toEqual([]);
    const movedFirst = receiver.env.deserializeWithTransfer(firstTransfer).deserialized;
    const firstImpl = receiver.context.unwrap(movedFirst, MessagePortImpl)!;
    expect(receiver.global.ports).toEqual([firstImpl]);
    const movedSecond = other.env.deserializeWithTransfer(secondTransfer).deserialized;
    const secondImpl = other.context.unwrap(movedSecond, MessagePortImpl)!;
    expect(sender.global.ports).toEqual([]);
    if (destination === 'same') {
      expect(receiver.global.ports).toEqual([]);
    } else {
      expect(receiver.global.ports).toEqual([firstImpl]);
      expect(other.global.ports).toEqual([secondImpl]);
    }
  });

  it('selects the Window\'s current associated Document without requiring it to be fully active', () => {
    const { env, document } = createWindow();
    expect(document.isFullyActive()).toBe(false);
    expect(WorkerGlobalImpl.getRelevantOwner(env)).toBe(document);
    const replacement = env.createDocument();
    env.window.setAssociatedDocument(replacement);
    expect(WorkerGlobalImpl.getRelevantOwner(env)).toBe(replacement);
  });

  it.each(['dedicated', 'shared'] as const)('keeps a nested worker\'s %s owner instead of flattening its owner set', (kind) => {
    const parent = createWorker(kind);
    const child = createWorker();
    const { document } = createWindow();
    parent.global.ownerSet.add(document);
    child.global.ownerSet.add(WorkerGlobalImpl.getRelevantOwner(parent.env));
    expect([...child.global.ownerSet]).toEqual([parent.global]);
  });
});

describe('Worker extended lifetime and active need (HTML §10.2.3)', () => {
  it('extends only opted-in shared workers, strictly before the configured deadline', () => {
    const userAgent = new UserAgent();
    let now = 10;
    vi.spyOn(userAgent, 'unsafeSharedCurrentTime').mockImplementation(() => now);
    userAgent.serviceWorkerWithoutClientsTimeout = 100;
    const shared = createExtendedWorker(userAgent);
    const ordinaryShared = createWorker('shared', userAgent).global;
    const dedicated = createWorker('dedicated', userAgent).global;

    expect(shared.isInExtendedLifetime()).toBe(true);
    expect(shared.isActivelyNeeded()).toBe(true);
    expect(ordinaryShared.isInExtendedLifetime()).toBe(false);
    expect(ordinaryShared.isActivelyNeeded()).toBe(false);
    expect(dedicated.isInExtendedLifetime()).toBe(false);
    expect(dedicated.isActivelyNeeded()).toBe(false);
    now = 109;
    expect(shared.isInExtendedLifetime()).toBe(true);
    now = 110;
    expect(shared.isInExtendedLifetime()).toBe(false);
    expect(shared.isActivelyNeeded()).toBe(false);

    // The shared timeout uses the same configurable ceiling as Service Workers.
    userAgent.serviceWorkerWithoutClientsTimeout = 101;
    expect(shared.isInExtendedLifetime()).toBe(true);
    userAgent.serviceWorkerWithoutClientsTimeout = 0;
    expect(shared.isInExtendedLifetime()).toBe(false);
  });

  it('starts the ownerless period only when the last owner leaves, without restarting on redundant removals', () => {
    const userAgent = new UserAgent();
    let now = 0;
    vi.spyOn(userAgent, 'unsafeSharedCurrentTime').mockImplementation(() => now);
    userAgent.serviceWorkerWithoutClientsTimeout = 100;
    const shared = createExtendedWorker(userAgent);
    const first = createWorker('dedicated', userAgent).global;
    const second = createWorker('dedicated', userAgent).global;
    shared.ownerSet.add(first).add(second);
    now = 200;
    shared.ownerSet.delete(first);
    expect(shared.isInExtendedLifetime()).toBe(false);
    now = 300;
    shared.ownerSet.delete(second);
    expect(shared.isInExtendedLifetime()).toBe(true);
    now = 399;
    shared.ownerSet.delete(first);
    shared.ownerSet.clear();
    expect(shared.isInExtendedLifetime()).toBe(true);
    now = 400;
    expect(shared.isInExtendedLifetime()).toBe(false);
  });

  it('starts a fresh ownerless period after reconnecting, whether the last owner is deleted or cleared', () => {
    const userAgent = new UserAgent();
    let now = 0;
    vi.spyOn(userAgent, 'unsafeSharedCurrentTime').mockImplementation(() => now);
    userAgent.serviceWorkerWithoutClientsTimeout = 100;
    const shared = createExtendedWorker(userAgent);
    const owner = createWorker('dedicated', userAgent).global;
    now = 50;
    shared.ownerSet.add(owner);
    expect(shared.isInExtendedLifetime()).toBe(false);
    now = 80;
    shared.ownerSet.delete(owner);
    now = 100;
    expect(shared.isInExtendedLifetime()).toBe(true);
    now = 179;
    expect(shared.isInExtendedLifetime()).toBe(true);
    now = 180;
    expect(shared.isInExtendedLifetime()).toBe(false);
    shared.ownerSet.add(owner);
    now = 200;
    shared.ownerSet.clear();
    now = 299;
    expect(shared.isInExtendedLifetime()).toBe(true);
    now = 300;
    expect(shared.isInExtendedLifetime()).toBe(false);
  });

  it('measures each continuous Document inactivity period through real navigation notifications', () => {
    const userAgent = new UserAgent();
    let now = 0;
    vi.spyOn(userAgent, 'unsafeSharedCurrentTime').mockImplementation(() => now);
    userAgent.serviceWorkerWithoutClientsTimeout = 100;
    const traversable = TopLevelTraversable.create(userAgent, null, '');
    const document = traversable.activeDocument!;
    const activeEntry = traversable.activeSessionHistoryEntry;
    const emptyEntry = document.env.createSessionHistoryEntry(activeEntry.url, new DocumentState());
    const shared = createExtendedWorker(userAgent);
    shared.ownerSet.add(document);
    expect(shared.isInExtendedLifetime()).toBe(false);
    expect(shared.isActivelyNeeded()).toBe(true);

    now = 20;
    traversable.activeSessionHistoryEntry = emptyEntry;
    now = 119;
    document.notifyFullyActiveStateChanged();
    expect(shared.isInExtendedLifetime()).toBe(true);
    expect(shared.isActivelyNeeded()).toBe(true);
    now = 120;
    expect(shared.isInExtendedLifetime()).toBe(false);
    expect(shared.isActivelyNeeded()).toBe(false);

    traversable.activeSessionHistoryEntry = activeEntry;
    expect(shared.isInExtendedLifetime()).toBe(false);
    expect(shared.isActivelyNeeded()).toBe(true);
    now = 150;
    traversable.activeSessionHistoryEntry = emptyEntry;
    now = 249;
    expect(shared.isInExtendedLifetime()).toBe(true);
    now = 250;
    expect(shared.isInExtendedLifetime()).toBe(false);
  });

  it('does not restart a Document\'s inactivity period when that Document joins the owner set', () => {
    const userAgent = new UserAgent();
    let now = 0;
    vi.spyOn(userAgent, 'unsafeSharedCurrentTime').mockImplementation(() => now);
    userAgent.serviceWorkerWithoutClientsTimeout = 100;
    const { document } = createWindow(userAgent);
    now = 99;
    const shared = createExtendedWorker(userAgent);
    shared.ownerSet.add(document);
    expect(shared.isInExtendedLifetime()).toBe(true);
    now = 100;
    expect(shared.isInExtendedLifetime()).toBe(false);
    expect(shared.isActivelyNeeded()).toBe(false);
  });

  it.each(['first', 'last'])('checks an active Document %s in the owner set before granting any extension', (position) => {
    const userAgent = new UserAgent();
    vi.spyOn(userAgent, 'unsafeSharedCurrentTime').mockReturnValue(0);
    const active = TopLevelTraversable.create(userAgent, null, '').activeDocument!;
    const inactive = createWindow(userAgent).document;
    const extendedOwner = createExtendedWorker(userAgent);
    const shared = createExtendedWorker(userAgent);
    if (position === 'first') shared.ownerSet.add(active);
    shared.ownerSet.add(inactive).add(extendedOwner);
    if (position === 'last') shared.ownerSet.add(active);
    expect(shared.isInExtendedLifetime()).toBe(false);
    expect(shared.isActivelyNeeded()).toBe(true);
    shared.ownerSet.delete(active);
    expect(shared.isInExtendedLifetime()).toBe(true);
  });

  it('propagates active need through dedicated and shared owners without giving dedicated workers an extension', () => {
    const userAgent = new UserAgent();
    vi.spyOn(userAgent, 'unsafeSharedCurrentTime').mockReturnValue(0);
    const parent = createExtendedWorker(userAgent);
    const dedicated = createWorker('dedicated', userAgent).global;
    const shared = createExtendedWorker(userAgent);
    dedicated.ownerSet.add(parent);
    shared.ownerSet.add(dedicated);
    expect(dedicated.isInExtendedLifetime()).toBe(false);
    expect(dedicated.isActivelyNeeded()).toBe(true);
    expect(shared.isInExtendedLifetime()).toBe(false);
    expect(shared.isActivelyNeeded()).toBe(true);
    parent.extendedLifetime = false;
    expect(shared.isActivelyNeeded()).toBe(false);
    const document = TopLevelTraversable.create(userAgent, null, '').activeDocument!;
    parent.ownerSet.add(document);
    expect(shared.isActivelyNeeded()).toBe(true);
  });

  it('follows shared-owner extension but requires each shared worker to opt in', () => {
    const userAgent = new UserAgent();
    vi.spyOn(userAgent, 'unsafeSharedCurrentTime').mockReturnValue(0);
    const parent = createExtendedWorker(userAgent);
    const child = createExtendedWorker(userAgent);
    child.ownerSet.add(parent);
    expect(child.isInExtendedLifetime()).toBe(true);
    child.extendedLifetime = false;
    expect(child.isInExtendedLifetime()).toBe(false);
    expect(child.isActivelyNeeded()).toBe(true);
    parent.extendedLifetime = false;
    expect(child.isActivelyNeeded()).toBe(false);
  });

  it('does not let an ownership cycle keep itself active, but still finds an eligible owner beyond the cycle', () => {
    const userAgent = new UserAgent();
    vi.spyOn(userAgent, 'unsafeSharedCurrentTime').mockReturnValue(0);
    const first = createExtendedWorker(userAgent);
    const second = createExtendedWorker(userAgent);
    first.ownerSet.add(second);
    second.ownerSet.add(first);
    expect(first.isInExtendedLifetime()).toBe(false);
    expect(first.isActivelyNeeded()).toBe(false);
    const extended = createExtendedWorker(userAgent);
    second.ownerSet.add(extended);
    expect(first.isInExtendedLifetime()).toBe(true);
    expect(first.isActivelyNeeded()).toBe(true);
    second.ownerSet.delete(extended);
    const active = TopLevelTraversable.create(userAgent, null, '').activeDocument!;
    second.ownerSet.add(active);
    expect(first.isInExtendedLifetime()).toBe(false);
    expect(first.isActivelyNeeded()).toBe(true);
  });
});

describe('Worker protection, permission, and suspension (HTML §10.2.3)', () => {
  it('does not keep an ownerless dedicated worker permissible just because it has ports or timers', () => {
    const { global, env } = createWorker();
    const other = createWorker();
    const local = new MessagePortImpl(env);
    local.entangle(new MessagePortImpl(other.env));
    env.getWindowOrWorkerGlobalScopeMixin().timers.setTimeout(() => {}, 10, []);
    expect(global.isActivelyNeeded()).toBe(false);
    expect(global.isProtected()).toBe(false);
    expect(global.isPermissible()).toBe(false);
    expect(global.isSuspendable()).toBe(false);
  });

  it('makes a dedicated worker protected only while its active need has outstanding work or a port', () => {
    const userAgent = new UserAgent();
    const document = TopLevelTraversable.create(userAgent, null, '').activeDocument!;
    const { global, env, context } = createWorker('dedicated', userAgent);
    global.ownerSet.add(document);
    expect(global.isActivelyNeeded()).toBe(true);
    expect(global.isPermissible()).toBe(true);
    expect(global.isProtected()).toBe(false);
    expect(global.isSuspendable()).toBe(false);
    const { timers } = env.getWindowOrWorkerGlobalScopeMixin();
    const id = timers.setTimeout(() => {}, 10, []);
    expect(global.isProtected()).toBe(true);
    timers.clearTimer(id);
    expect(global.isProtected()).toBe(false);
    new MessageChannelImpl(env);
    expect(global.isProtected()).toBe(false);
    const local = new MessagePortImpl(env);
    const remote = new MessagePortImpl(document.env);
    local.entangle(remote);
    expect(global.isProtected()).toBe(true);
    const platform = document.env.project(remote)!;
    const transferred = document.env.serializeWithTransfer(platform, [platform]);
    expect(global.isProtected()).toBe(true);
    const received = env.deserializeWithTransfer(transferred).deserialized;
    expect(context.unwrap(received, MessagePortImpl)).toBeDefined();
    expect(global.isProtected()).toBe(false);
  });

  it('protects active workers during Fetch completion and releases completed requests', () => {
    const userAgent = new UserAgent();
    const { global, env } = createWorker('dedicated', userAgent);
    global.ownerSet.add(TopLevelTraversable.create(userAgent, null, '').activeDocument!);
    const request = createFetchRequest();
    env.fetchGroup.fetchRecords.push({ request, controller: null });
    expect(global.isProtected()).toBe(true);
    request.done = true;
    expect(global.isProtected()).toBe(false);
  });

  it('keeps an EventSource reconnect wait protected even after its Fetch completes', async () => {
    const userAgent = new UserAgent();
    userAgent.timerHost = { scheduleTimeout() { return { remove() {} }; } };
    const { global, env } = createWorker('dedicated', userAgent);
    global.ownerSet.add(TopLevelTraversable.create(userAgent, null, '').activeDocument!);
    const source = new EventSourceImpl('data:text/event-stream,', { withCredentials: false }, env);
    try {
      expect(global.isProtected()).toBe(true);
      await vi.waitFor(() => {
        while (env.responsibleEventLoop.runTaskTurn()) { /* Deliver Fetch and reconnection tasks. */ }
        expect(env.fetchGroup.fetchRecords.length).toBeGreaterThan(0);
        expect(env.fetchGroup.hasPendingFetches()).toBe(false);
      });
      expect(global.isProtected()).toBe(true);
    } finally {
      source.close();
    }
    expect(global.isProtected()).toBe(false);
  });

  it('protects active shared workers without any ports or asynchronous work', () => {
    const userAgent = new UserAgent();
    const global = createWorker('shared', userAgent).global;
    const document = TopLevelTraversable.create(userAgent, null, '').activeDocument!;
    global.ownerSet.add(document);
    expect(global.isProtected()).toBe(true);
    expect(global.isSuspendable()).toBe(false);
    global.ownerSet.clear();
    expect(global.isProtected()).toBe(false);
  });

  it('keeps an ownerless extended worker protected and permissible without a loading page', () => {
    const userAgent = new UserAgent();
    let now = 0;
    vi.spyOn(userAgent, 'unsafeSharedCurrentTime').mockImplementation(() => now);
    const global = createExtendedWorker(userAgent);
    expect(global.isProtected()).toBe(true);
    expect(global.isPermissible()).toBe(true);
    expect(global.isSuspendable()).toBe(false);
    now = userAgent.extendedLifetimeSharedWorkerTimeout;
    expect(global.isProtected()).toBe(false);
    expect(global.isPermissible()).toBe(false);
    expect(global.isSuspendable()).toBe(false);
  });

  it('allows suspension through inactive owners and ownership cycles, without granting active need', () => {
    const userAgent = new UserAgent();
    const first = createWorker('dedicated', userAgent).global;
    const second = createWorker('shared', userAgent).global;
    const document = createWindow(userAgent).document;
    first.ownerSet.add(document);
    second.ownerSet.add(first);
    for (const global of [first, second]) {
      expect(global.isPermissible()).toBe(true);
      expect(global.isProtected()).toBe(false);
      expect(global.isSuspendable()).toBe(true);
    }
    first.ownerSet.delete(document);
    first.ownerSet.add(second);
    expect(first.isSuspendable()).toBe(true);
    expect(second.isSuspendable()).toBe(true);
  });

  it('permits an ownerless shared worker through the inclusive between-loads limit, then expires it', () => {
    const userAgent = new UserAgent();
    userAgent.betweenLoadsSharedWorkerTimeout = 10;
    let now = 0;
    vi.spyOn(userAgent, 'unsafeSharedCurrentTime').mockImplementation(() => now);
    const global = createWorker('shared', userAgent).global;
    expect(global.isPermissible()).toBe(false);
    const document = TopLevelTraversable.create(userAgent, null, '').activeDocument!;
    document.completelyLoadedTime = null;
    expect(global.isPermissible()).toBe(true);
    expect(global.isProtected()).toBe(false);
    expect(global.isSuspendable()).toBe(true);
    now = 10;
    expect(global.isPermissible()).toBe(true);
    now = 11;
    expect(global.isPermissible()).toBe(false);
    expect(global.isSuspendable()).toBe(false);
    global.ownerSet.add(document);
    now = 20;
    global.ownerSet.delete(document);
    expect(global.isPermissible()).toBe(true);
    document.completelyFinishLoading();
    expect(global.isPermissible()).toBe(false);
  });

  it('does not borrow loading activity from another UserAgent or grant the grace period to dedicated workers', () => {
    const userAgent = new UserAgent();
    vi.spyOn(userAgent, 'unsafeSharedCurrentTime').mockReturnValue(0);
    TopLevelTraversable.create(new UserAgent(), null, '').activeDocument!.completelyLoadedTime = null;
    const shared = createWorker('shared', userAgent).global;
    const dedicated = createWorker('dedicated', userAgent).global;
    expect(shared.isPermissible()).toBe(false);
    TopLevelTraversable.create(userAgent, null, '').activeDocument!.completelyLoadedTime = null;
    expect(shared.isPermissible()).toBe(true);
    expect(dedicated.isPermissible()).toBe(false);
  });

  it('counts a loading child even beneath an inactive ancestor, but excludes replaced Documents', () => {
    const userAgent = new UserAgent();
    vi.spyOn(userAgent, 'unsafeSharedCurrentTime').mockReturnValue(0);
    const root = TopLevelTraversable.create(userAgent, null, '');
    const document = root.activeDocument!;
    document.completelyFinishLoading();
    const container = document.createElement('iframe') as HTMLIFrameElementImpl;
    document.body!.appendChild(container);
    const [, child] = BrowsingContext.create(document, container, root.activeBrowsingContext!.group!);
    const navigable = new Navigable(DocumentState.create(child), root);
    container.contentNavigable = navigable;
    child.completelyLoadedTime = null;
    const global = createWorker('shared', userAgent).global;
    expect(global.isPermissible()).toBe(true);
    root.activeSessionHistoryEntry = document.env.createSessionHistoryEntry(document.url, new DocumentState());
    expect(child.isFullyActive()).toBe(false);
    expect(global.isPermissible()).toBe(true);
    navigable.activeSessionHistoryEntry = child.env.createSessionHistoryEntry(child.url, new DocumentState());
    expect(global.isPermissible()).toBe(false);
  });
});

/** Manually supplies settings used by ports, timers, and Fetch; this is not HTML worker startup. */
class TestEnvironment extends SandboxEnvironment {
  /** Set explicitly by the fixture before projection or lifetime queries. */
  workerGlobal!: WorkerGlobalImpl;
  /** Resource ownership used by the production MessagePort lifecycle. */
  #mixin: WindowOrWorkerGlobalScopeMixin | undefined;
  /** Stable origin for the fixture's timer and Fetch clocks. */
  #timeOrigin = monotonicClock.unsafeCurrentTime().coarsen();

  override get globalImplementation(): WorkerGlobalImpl { return this.workerGlobal; }
  override get apiBaseURL(): URLRecord { return this.workerGlobal.url!; }
  override get origin(): Origin { return obtainURLOrigin(this.apiBaseURL); }
  override get hasCrossSiteAncestor(): boolean { return false; }
  override get policyContainer(): PolicyContainer { return this.workerGlobal.policyContainer; }
  override get timeOrigin(): Moment { return this.#timeOrigin; }

  override getWindowOrWorkerGlobalScopeMixin(): WindowOrWorkerGlobalScopeMixin {
    return this.#mixin ??= new WindowOrWorkerGlobalScopeMixin(this);
  }
}

/** Manual globals exercise ownership and real Binding transfers without introducing a worker backend. */
function createWorker(kind: 'dedicated' | 'shared' = 'dedicated', userAgent = new UserAgent()) {
  const name = kind === 'dedicated' ? 'DedicatedWorker' : 'SharedWorker';
  const realm = new BrowletRealm({ agent: new SandboxAgent(new EventLoop({ requestTurn() {} })), globalNames: ['Worker', name] });
  let env!: TestEnvironment;
  const context = browletBindingWorld.register(realm, (binding) => {
    env = new TestEnvironment(realm, createBrowletEnvironmentInit(binding), userAgent);
    return env;
  });
  const url = parseURL('https://worker.test/main.js').url!;
  const global = kind === 'dedicated'
    ? new DedicatedWorkerGlobalImpl('classic', '', env)
    : new SharedWorkerGlobalImpl('classic', '', new StorageKey(obtainURLOrigin(url)), url, 'same-origin', false, env);
  env.workerGlobal = global;
  global.url = url;
  env.creationURL = url;
  realm.initialize({ createGlobalObject: () => context.projectGlobalObject(global, `${name}GlobalScope`) });
  return { global, env, context };
}

/** Shared global with the creation option enabled, without supplying startup or lifetime monitoring. */
function createExtendedWorker(userAgent: UserAgent): SharedWorkerGlobalImpl {
  const global = createWorker('shared', userAgent).global as SharedWorkerGlobalImpl;
  global.extendedLifetime = true;
  return global;
}

/** A real Window environment with an associated, inactive Document; activity is irrelevant to owner selection. */
function createWindow(userAgent = new UserAgent()) {
  const agent = new WindowAgent(new EventLoop({ requestTurn() {} }));
  new AgentCluster().add(agent);
  const creationURL = parseURL('https://window.test/').url!;
  const origin = obtainURLOrigin(creationURL);
  const env = createWindowEnvironment({
    userAgent, agent, creationURL, origin, parent: null,
    topLevelCreationURL: creationURL, topLevelOrigin: origin,
  });
  const document = env.createDocument();
  env.window.setAssociatedDocument(document);
  return { env, document };
}
