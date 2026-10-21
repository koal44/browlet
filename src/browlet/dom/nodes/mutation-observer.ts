import { TypeError } from '../../../infra/exceptions';
import { InternalError } from '../../../infra/internal-error';
import {
  arg, atArg, ctor, defineCallbackFunction, defineDictionary, defineInterface, dictMember,
  emptyDictionary, idlType, impl, onError, op, reference, sequence,
} from '../../../web-idl/core/index';

import type { DOMEnvironment } from '../environment';

import type { MutationRecordImpl } from './mutation-record';
import type { NodeImpl } from './node';

/** Registrations and pending records for one converted author callback. */
// https://dom.spec.whatwg.org/#interface-mutationobserver
export class MutationObserverImpl {
  /** Stable creation order used by the Agent when delivering a batch of observers. */
  readonly creationOrder: number;
  /** Web IDL supplies argument projection, callback entry, and exception reporting. */
  #callback: MutationCallback;
  /** Observation must not keep otherwise unreachable targets alive. */
  #nodes = new Set<WeakRef<NodeImpl>>();
  /** Weak detached-node references used to remove transient registrations. */
  #transientNodes = new Set<WeakRef<NodeImpl>>();
  /** Undelivered records in mutation order. */
  #records: MutationRecordImpl[] = [];

  constructor(callback: MutationCallback, env: DOMEnvironment) {
    const realm = env.realm;
    if (!realm.isWindow()) throw new InternalError('MutationObserver requires a Window realm');
    this.#callback = callback;
    this.creationOrder = realm.agent.mutationObserverCounter++;
  }

  /** Register or replace this observer's options for a target. */
  // https://dom.spec.whatwg.org/#dom-mutationobserver-observe
  observe(target: NodeImpl, options: MutationObserverInit): void {
    if ((options.attributeOldValue !== undefined || options.attributeFilter !== undefined) &&
      options.attributes === undefined) options.attributes = true;
    if (options.characterDataOldValue !== undefined && options.characterData === undefined) {
      options.characterData = true;
    }
    if (!options.childList && !options.attributes && !options.characterData) {
      throw new TypeError('At least one mutation type must be observed');
    }
    if (options.attributeOldValue && !options.attributes) {
      throw new TypeError('Attribute old values require attribute observation');
    }
    if (options.attributeFilter !== undefined && !options.attributes) {
      throw new TypeError('An attribute filter requires attribute observation');
    }
    if (options.characterDataOldValue && !options.characterData) {
      throw new TypeError('Character-data old values require character-data observation');
    }

    const registered = target.registeredObserverList.find((entry) => entry.observer === this && !entry.source);
    if (registered) {
      this.#removeTransientRegistrations(registered);
      registered.options = options;
    } else {
      target.registeredObserverList.push({ observer: this, options });
      this.#nodes.add(new WeakRef(target));
    }
  }

  /** Remove all registrations and discard undelivered records. */
  // https://dom.spec.whatwg.org/#dom-mutationobserver-disconnect
  disconnect(): void {
    for (const reference of this.#nodes) {
      const node = reference.deref();
      if (node) {
        node.registeredObserverList = node.registeredObserverList.filter((entry) => entry.observer !== this);
      }
    }
    this.#nodes.clear();
    this.#removeTransientRegistrations();
    this.#records = [];
  }

  /** Drain records without ending observation or clearing transient registrations. */
  // https://dom.spec.whatwg.org/#dom-mutationobserver-takerecords
  takeRecords(): MutationRecordImpl[] {
    const records = this.#records;
    this.#records = [];
    return records;
  }

  /** Retain a record until notification or takeRecords(). */
  enqueueRecord(record: MutationRecordImpl): void {
    this.#records.push(record);
  }

  /** Continue observing a removed subtree until this observer's next notification. */
  // https://dom.spec.whatwg.org/#add-transient-registered-observers
  addTransientRegistration(target: NodeImpl, source: RegisteredObserver): void {
    // Nested detachments retain the original observation as their cleanup owner.
    source = source.source ?? source;
    let alreadyTracked = false;
    for (const registered of target.registeredObserverList) {
      if (registered.source === source) return;
      if (registered.observer === this && registered.source) alreadyTracked = true;
    }
    target.registeredObserverList.push({ observer: this, options: source.options, source });
    if (!alreadyTracked) this.#transientNodes.add(new WeakRef(target));
    const realm = target.env.realm;
    if (realm.isWindow()) {
      realm.agent.pendingMutationObservers.add(this);
      realm.agent.queueMutationObserverMicrotask();
    }
  }

  /** Clear this batch and its transient registrations before entering author code. */
  // https://dom.spec.whatwg.org/#notify-mutation-observers
  notify(): void {
    const records = this.takeRecords();
    this.#removeTransientRegistrations();
    for (const reference of this.#nodes) {
      if (!reference.deref()) this.#nodes.delete(reference);
    }
    // SPEC_CLASH(mutation-observer-callback-realm): browser argument realms differ; retain Web IDL's contract.
    // Arrays use the callback realm; platform objects retain the observer's binding ownership.
    // Chromium uses the callback realm for both; Firefox/WebKit use the observer realm for both.
    if (records.length) this.#callback.call(this, records, this);
  }

  /** Remove detached-subtree observation, optionally limited to one original registration. */
  #removeTransientRegistrations(source?: RegisteredObserver): void {
    for (const reference of this.#transientNodes) {
      const node = reference.deref();
      if (!node) {
        this.#transientNodes.delete(reference);
        continue;
      }
      node.registeredObserverList = node.registeredObserverList.filter((entry) =>
        entry.observer !== this || !entry.source || (source !== undefined && entry.source !== source));
      if (!node.registeredObserverList.some((entry) => entry.observer === this && entry.source)) {
        this.#transientNodes.delete(reference);
      }
    }
  }
}

/** Implementation-facing signature of the converted MutationCallback. */
export type MutationCallback = (
  this: MutationObserverImpl, records: MutationRecordImpl[], observer: MutationObserverImpl,
) => void;

/** A node's observer association, including an optional transient source. */
// https://dom.spec.whatwg.org/#registered-observer
export type RegisteredObserver = {
  observer: MutationObserverImpl;
  options: MutationObserverInit;
  source?: RegisteredObserver;
};

/** Post-conversion observation options; optional flags are normalized by observe(). */
export type MutationObserverInit = {
  childList: boolean;
  attributes?: boolean;
  characterData?: boolean;
  subtree: boolean;
  attributeOldValue?: boolean;
  characterDataOldValue?: boolean;
  attributeFilter?: string[];
};

/*
 * [Exposed=Window]
 * interface MutationObserver {
 *   constructor(MutationCallback callback);
 *   undefined observe(Node target, optional MutationObserverInit options = {});
 *   undefined disconnect();
 *   sequence<MutationRecord> takeRecords();
 * };
 */
export const mutationObserverIDL = defineInterface<DOMEnvironment>({
  name: 'MutationObserver',
  exposed: 'Window',
  implementation: impl(MutationObserverImpl, {
    constructWith: [atArg(1, (env) => env)],
  }),
  members: [
    ctor([arg('callback', reference('MutationCallback'), onError('report'))]),
    op('observe', idlType.undefined,
      [
        arg('target', reference('Node')),
        arg('options', reference('MutationObserverInit'), { optional: true, default: emptyDictionary }),
      ],
    ),
    op('disconnect', idlType.undefined),
    op('takeRecords', sequence(reference('MutationRecord'))),
  ],
});

/*
 * callback MutationCallback = undefined (sequence<MutationRecord> mutations, MutationObserver observer);
 */
export const mutationCallbackIDL = defineCallbackFunction({
  name: 'MutationCallback',
  returns: idlType.undefined,
  arguments: [arg('mutations', sequence(reference('MutationRecord'))), arg('observer', reference('MutationObserver'))],
});

/*
 * dictionary MutationObserverInit {
 *   boolean childList = false;
 *   boolean attributes;
 *   boolean characterData;
 *   boolean subtree = false;
 *   boolean attributeOldValue;
 *   boolean characterDataOldValue;
 *   sequence<DOMString> attributeFilter;
 * };
 */
export const mutationObserverInitIDL = defineDictionary({
  name: 'MutationObserverInit',
  members: [
    dictMember('childList', idlType.boolean, { default: false }),
    dictMember('attributes', idlType.boolean),
    dictMember('characterData', idlType.boolean),
    dictMember('subtree', idlType.boolean, { default: false }),
    dictMember('attributeOldValue', idlType.boolean),
    dictMember('characterDataOldValue', idlType.boolean),
    dictMember('attributeFilter', sequence(idlType.DOMString)),
  ],
});
