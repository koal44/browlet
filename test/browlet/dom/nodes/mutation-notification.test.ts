import { describe, expect, it } from 'vitest';
import { createWindowEnvironment } from '../../../../src/browlet/bindings';
import { BrowsingContext, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import type { WindowRealm } from '../../../../src/browlet/scripting/realm';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/element';
import type { HTMLSlotElementImpl } from '../../../../src/browlet/dom/nodes/html/scripting/slot';
import type { MutationObserverImpl } from '../../../../src/browlet/dom/nodes/mutation-observer';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';
import { collectGarbage } from '../../../support/garbage-collection';

describe('Mutation notification ownership', () => {
  it('numbers observers across shared-Agent Windows independently of other Agents', () => {
    const first = createWindow();
    const sibling = createWindow(first.realm);
    const separate = createWindow();
    const observers = [first, separate, sibling, first].map(({ window }) =>
      unwrap<MutationObserverImpl>(new window.MutationObserver(() => {})));
    expect(observers.map((observer) => observer.creationOrder)).toEqual([0, 0, 1, 2]);
  });

  it('batches same-Agent Windows together while leaving a different Agent pending', () => {
    const first = createWindow();
    const sibling = createWindow(first.realm);
    const separate = createWindow();
    const order: string[] = [];
    const entries = [first, sibling, separate].map(({ realm, window }, index) => {
      const callback = realm.createFunction(() => { order.push(String(index)); }, { name: 'record', length: 2 });
      const observer = new window.MutationObserver(callback);
      const target = window.document.createElement('div');
      observer.observe(target, { attributes: true });
      return { observer, target };
    });
    for (const { target } of entries.toReversed()) target.setAttribute('id', 'changed');
    expect(order).toEqual([]);
    first.realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(order).toEqual(['0', '1']);
    separate.realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(order).toEqual(['0', '1', '2']);
  });

  it('projects callback arrays in the callback realm while preserving platform ownership and identity', () => {
    const owner = createWindow();
    const foreign = createWindow(owner.realm);
    const delivered: { receiver: unknown; records: MutationRecord[]; observer: MutationObserver; }[] = [];
    const callback = foreign.realm.createFunction((receiver, args) => {
      const [records, observer] = args as [MutationRecord[], MutationObserver];
      delivered.push({ receiver, records, observer });
    }, { name: 'record', length: 2 });
    const observer = new owner.window.MutationObserver(callback);
    const target = owner.window.document.createElement('div');
    observer.observe(target, { attributes: true });
    target.setAttribute('id', 'changed');
    owner.realm.agent.eventLoop.performMicrotaskCheckpoint();

    expect(delivered).toHaveLength(1);
    const batch = delivered[0]!;
    expect(batch.receiver).toBe(observer);
    expect(batch.observer).toBe(observer);
    expect(batch.records).toBeInstanceOf(foreign.window.Array);
    expect(batch.records[0]).toBeInstanceOf(owner.window.MutationRecord);
    expect(batch.records[0]!.target).toBe(target);
    expect(batch.records[0]!.addedNodes).toBeInstanceOf(owner.window.NodeList);
  });

  it('observes ordinary ancestors without crossing a shadow host', () => {
    const { realm, window } = createWindow();
    const host = window.document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const child = window.document.createElement('span');
    shadow.appendChild(child);
    const outside = new window.MutationObserver(() => {});
    const inside = new window.MutationObserver(() => {});
    outside.observe(host, { subtree: true, attributes: true, childList: true });
    inside.observe(shadow, { subtree: true, attributes: true, childList: true });
    child.setAttribute('id', 'inside');
    child.remove();
    child.setAttribute('id', 'detached-before-notification');
    expect(outside.takeRecords()).toEqual([]);
    expect(inside.takeRecords().map((record) => record.type)).toEqual(['attributes', 'childList', 'attributes']);
    realm.agent.eventLoop.performMicrotaskCheckpoint();
    child.setAttribute('id', 'after-notification');
    expect(inside.takeRecords()).toEqual([]);
  });

  it('deduplicates transient registrations by source while preserving independent observations', () => {
    const { realm, window } = createWindow();
    const parent = window.document.createElement('div');
    const branch = window.document.createElement('section');
    const child = window.document.createElement('span');
    parent.append(branch, child);
    const observer = new window.MutationObserver(() => {});
    observer.observe(parent, { subtree: true, attributes: true });
    observer.observe(branch, { subtree: true, attributes: true });
    child.remove();
    branch.append(child);
    child.remove();
    const childImpl = unwrap<ElementImpl>(child);
    expect(childImpl.registeredObserverList).toHaveLength(2);

    observer.observe(parent, { subtree: true, attributes: true });
    expect(childImpl.registeredObserverList).toHaveLength(1);
    child.setAttribute('id', 'still-observed-through-branch');
    expect(observer.takeRecords()).toHaveLength(1);
    realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(childImpl.registeredObserverList).toEqual([]);
  });

  it('does not keep unrecorded detached nodes alive while cleanup is pending', async () => {
    const { realm, window } = createWindow();
    const parent = window.document.createElement('div');
    const delivered: MutationRecord[][] = [];
    const observer = new window.MutationObserver((records) => delivered.push(records));
    observer.observe(parent, { subtree: true, attributes: true });
    const detached = (() => {
      const child = window.document.createElement('span');
      parent.append(child);
      child.remove();
      return new WeakRef(unwrap<ElementImpl>(child));
    })();
    expect(observer.takeRecords()).toEqual([]);
    await collectGarbage([detached]);
    expect(detached.deref() === undefined).toBe(true);
    expect(realm.agent.pendingMutationObservers.has(unwrap<MutationObserverImpl>(observer))).toBe(true);
    realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(delivered).toEqual([]);
    observer.disconnect();
  });
});

describe('Slot-change notification', () => {
  it('coalesces signals and delivers trusted bubbling events after observers, using the batch snapshot', () => {
    const { realm, window } = createWindow();
    const parent = window.document.createElement('div');
    const first = window.document.createElement('slot');
    const second = window.document.createElement('slot');
    parent.append(first, second);
    const firstImpl = unwrap<HTMLSlotElementImpl>(first);
    const secondImpl = unwrap<HTMLSlotElementImpl>(second);
    const log: unknown[] = [];
    for (const [name, slot] of [['first', first], ['second', second]] as const) {
      slot.addEventListener('slotchange', (event) => {
        log.push([name, event.bubbles, event.cancelable, event.composed, event.isTrusted, event.target === slot]);
      });
    }
    parent.addEventListener('slotchange', () => { log.push('parent'); });
    const observer = new window.MutationObserver(() => {
      log.push('observer');
      secondImpl.signalSlotChange();
    });
    observer.observe(parent, { attributes: true });
    parent.setAttribute('id', 'changed');
    // Isolate batch snapshot ordering; HTMLSlotElement tests cover assignment-triggered signals.
    firstImpl.signalSlotChange();
    firstImpl.signalSlotChange();
    realm.agent.eventLoop.queueMicrotask(() => { log.push('between-batches'); });
    expect(log).toEqual([]);
    realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(log).toEqual([
      'observer', ['first', true, false, false, true, true], 'parent', 'between-batches',
      ['second', true, false, false, true, true], 'parent',
    ]);
  });

  it('schedules delivery without any MutationObserver registrations', () => {
    const { realm, window } = createWindow();
    const slot = window.document.createElement('slot');
    let count = 0;
    slot.addEventListener('slotchange', () => { count++; });
    unwrap<HTMLSlotElementImpl>(slot).signalSlotChange();
    realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(count).toBe(1);
  });
});

/** Construct real Window bindings, optionally sharing an existing Window's Agent. */
function createWindow(siblingOf?: WindowRealm) {
  let realm: WindowRealm;
  if (siblingOf) {
    const env = siblingOf.env;
    const sibling = createWindowEnvironment({
      agent: siblingOf.agent, userAgent: env.userAgent, creationURL: env.creationURL,
      origin: env.origin, parent: null, topLevelCreationURL: env.creationURL, topLevelOrigin: env.origin,
    });
    realm = sibling.realm;
    const proxy = realm.windowProxy;
    const document = realm.env.createDocument();
    document.browsingContext = new BrowsingContext(proxy);
    sibling.window.setAssociatedDocument(document);
    proxy.setAssociatedWindow(realm.globalObject);
  } else {
    const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
    realm = getRelevantRealm(traversable.activeWindow!);
  }
  return { realm, window: realm.globalObject as unknown as Window & typeof globalThis };
}
