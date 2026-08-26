import {
  createDOMException, domExceptionName, type DOMExceptionName,
} from '../../../shared/dom-exception';
import { bind } from '../../../web-idl/index';
import {
  arg, defineInterface, idlType, op, readonlyAttr, reference, sequence, xattr,
} from '../../../web-idl/declaration/index';
import type { WebIDLRealmHost } from '../../../web-idl/javascript-realm';
import { queueGlobalTask } from '../../scripting/tasks';
import {
  EventHandlerMap, eventHandlerAttr,
} from '../../scripting/event-handlers';
import { runStepsAfterTimeout, timerTaskSource } from '../../scripting/timers';
import {
  EventTargetImpl, type EventTargetVirtuals, fireEvent,
} from '../events/event-target';
import {
  type AbortAlgorithmHandle, registerAbortSignal,
} from './abort-algorithm';

/*
 * [Exposed=*]
 * interface AbortSignal : EventTarget {
 *   [NewObject] static AbortSignal abort(optional any reason);
 *   [Exposed=(Window,Worker), NewObject] static AbortSignal timeout([EnforceRange] unsigned long long milliseconds);
 *   [NewObject] static AbortSignal any(sequence<AbortSignal> signals);
 *
 *   readonly attribute boolean aborted;
 *   readonly attribute any reason;
 *   undefined throwIfAborted();
 *
 *   attribute EventHandler onabort;
 * };
 */
export class AbortSignalImpl extends EventTargetImpl
{
  #abortAlgorithms = new Set<AbortAlgorithmHandleImpl>();
  #createDOMException: DOMExceptionFactory = createDOMException;
  #dependent = false;
  #dependentSignals = new WeakOrderedSet<AbortSignalImpl>();
  readonly #eventHandlers = new EventHandlerMap(this, [{
    name: 'onabort',
    type: 'abort',
  }]);
  #reason: unknown = undefined;
  #retention = new AbortSignalRetention();
  #sourceSignals = new WeakOrderedSet<AbortSignalImpl>();

  constructor() {
    super(abortSignalEventTargetVirtuals);
    registerAbortSignal(this, {
      add: (algorithm) => AbortSignalImpl.addAbortAlgorithm(this, algorithm),
      isAborted: () => this.#isAborted(),
    });
  }

  get aborted(): boolean {
    return this.#reason !== undefined;
  }

  get reason(): unknown {
    return this.#reason;
  }

  throwIfAborted(): void {
    if (this.#isAborted()) throw this.#reason;
  }

  // -- Friends ----------------------------------------------------------

  static initializeForBinding(
    signal: AbortSignalImpl,
    createException: DOMExceptionFactory,
    retention: AbortSignalRetention,
  ): void {
    signal.#createDOMException = createException;
    signal.#retention = retention;
    signal.#updateRetention();
  }

  static createDependent(
    signals: readonly AbortSignalImpl[],
    create: () => AbortSignalImpl,
  ): AbortSignalImpl {
    const result = create();

    for (const signal of signals) {
      if (signal.#isAborted()) {
        result.#setAbortReason(signal.#reason);
        return result;
      }
    }

    result.#dependent = true;
    for (const signal of signals) {
      if (signal.#dependent) {
        for (const source of signal.#sourceSignals.values()) {
          result.#dependOn(source);
        }
      } else {
        result.#dependOn(signal);
      }
    }
    result.#updateRetention();
    return result;
  }

  static createAborted(
    signal: AbortSignalImpl,
    reason: unknown,
  ): void {
    signal.#setAbortReason(
      reason === undefined ? signal.#createAbortError() : reason,
    );
  }

  static updateRetention(signal: AbortSignalImpl): void {
    signal.#updateRetention();
  }

  static getEventHandlers(signal: AbortSignalImpl): EventHandlerMap {
    return signal.#eventHandlers;
  }

  static isAborted(signal: AbortSignalImpl): boolean {
    return signal.#isAborted();
  }

  static addAbortAlgorithm(
    signal: AbortSignalImpl,
    algorithm: () => void,
  ): AbortAlgorithmHandle | null {
    if (signal.#isAborted()) return null;

    const handle = new AbortAlgorithmHandleImpl(signal, algorithm);
    signal.#abortAlgorithms.add(handle);
    signal.#updateRetention();
    return handle;
  }

  static removeAbortAlgorithm(
    signal: AbortSignalImpl,
    handle: AbortAlgorithmHandleImpl,
  ): void {
    if (!signal.#abortAlgorithms.delete(handle)) return;

    handle.detach();
    signal.#updateRetention();
  }

  static signalAbort(
    signal: AbortSignalImpl,
    reason: unknown = undefined,
  ): void {
    if (signal.#isAborted()) return;

    signal.#setAbortReason(
      reason === undefined ? signal.#createAbortError() : reason,
    );
    const dependents: AbortSignalImpl[] = [];
    for (const dependent of signal.#dependentSignals.values()) {
      if (dependent.#isAborted()) continue;

      dependent.#setAbortReason(signal.#reason);
      dependents.push(dependent);
    }

    signal.#runAbortSteps();
    for (const dependent of dependents) dependent.#runAbortSteps();
  }

  static signalTimeout(signal: AbortSignalImpl): void {
    AbortSignalImpl.signalAbort(
      signal,
      signal.#createDOMException(domExceptionName.timeout),
    );
  }

  #createAbortError(): DOMException {
    return this.#createDOMException(domExceptionName.abort);
  }

  #dependOn(source: AbortSignalImpl): void {
    this.#sourceSignals.add(source);
    source.#dependentSignals.add(this);
  }

  #isAborted(): boolean {
    return this.#reason !== undefined;
  }

  #runAbortSteps(): void {
    for (const handle of [...this.#abortAlgorithms]) {
      if (this.#abortAlgorithms.has(handle)) handle.run();
    }
    for (const handle of this.#abortAlgorithms) handle.detach();
    this.#abortAlgorithms.clear();
    this.#settle();
    fireEvent('abort', this);
  }

  #setAbortReason(reason: unknown): void {
    this.#reason = reason;
    this.#updateRetention();
  }

  #settle(): void {
    for (const source of this.#sourceSignals.values()) {
      source.#dependentSignals.delete(this);
    }
    this.#sourceSignals.clear();
    this.#dependentSignals.clear();
    this.#updateRetention();
  }

  #shouldRetain(): boolean {
    return !this.#isAborted() &&
      this.#dependent &&
      this.#sourceSignals.hasValue() &&
      (
        this.#abortAlgorithms.size > 0 ||
        EventTargetImpl.hasEventListener(this, 'abort')
      );
  }

  #updateRetention(): void {
    this.#retention.update(this, this.#shouldRetain());
  }
}

// -- Web IDL ------------------------------------------------------------

export const abortSignalIDL = defineInterface({
  name: 'AbortSignal',
  binding: bind(AbortSignalImpl, {
    initialize(context, value) {
      AbortSignalImpl.initializeForBinding(
        value as AbortSignalImpl,
        (name, message) =>
          context.exceptions.createDOMException(name, message),
        getAbortSignalRetention(context.realm),
      );
    },
  }),
  exposed: '*',
  inherits: 'EventTarget',
  members: [
    op('abort', reference('AbortSignal'), [
      arg('reason', idlType.any, { optional: true }),
    ], bind({
      invoke(context, reason) {
        const signal = context.objects.create(AbortSignalImpl);
        AbortSignalImpl.createAborted(signal, reason);
        return signal;
      },
    }, {
      static: true,
      ...xattr('NewObject'),
    })),
    op('timeout', reference('AbortSignal'), [
      arg(
        'milliseconds',
        idlType.unsignedLongLong,
        xattr('EnforceRange'),
      ),
    ], bind({
      invoke(context, milliseconds) {
        const signal = context.objects.create(AbortSignalImpl);
        const global = context.realm.global;

        runStepsAfterTimeout(
          global,
          'AbortSignal-timeout',
          milliseconds as number,
          () => {
            queueGlobalTask(
              timerTaskSource,
              global,
              () => AbortSignalImpl.signalTimeout(signal),
            );
          },
        );

        return signal;
      },
    }, {
      static: true,
      ...xattr(
        ['Exposed', ['Window', 'Worker']],
        'NewObject',
      ),
    })),
    op('any', reference('AbortSignal'), [
      arg('signals', sequence(reference('AbortSignal'))),
    ], bind({
      invoke(context, signals) {
        return AbortSignalImpl.createDependent(
          signals as AbortSignalImpl[],
          () => context.objects.create(AbortSignalImpl),
        );
      },
    }, {
      static: true,
      ...xattr('NewObject'),
    })),
    readonlyAttr('aborted', idlType.boolean),
    readonlyAttr('reason', idlType.any),
    op('throwIfAborted', idlType.undefined),
    eventHandlerAttr<AbortSignalImpl>(
      'onabort',
      (signal) => AbortSignalImpl.getEventHandlers(signal),
    ),
  ],
});

class AbortAlgorithmHandleImpl implements AbortAlgorithmHandle
{
  #algorithm: (() => void) | null;
  #signal: WeakRef<AbortSignalImpl> | null;

  constructor(signal: AbortSignalImpl, algorithm: () => void) {
    this.#algorithm = algorithm;
    this.#signal = new WeakRef(signal);
  }

  remove(): void {
    const signal = this.#signal?.deref();
    if (signal) AbortSignalImpl.removeAbortAlgorithm(signal, this);
    else this.detach();
  }

  run(): void {
    this.#algorithm?.();
  }

  detach(): void {
    this.#algorithm = null;
    this.#signal = null;
  }
}

class AbortSignalRetention
{
  #signals = new Set<AbortSignalImpl>();

  update(signal: AbortSignalImpl, retain: boolean): void {
    if (retain) this.#signals.add(signal);
    else this.#signals.delete(signal);
  }
}

class WeakOrderedSet<T extends object>
{
  #references = new Set<WeakRef<T>>();
  #referencesByValue = new WeakMap<T, WeakRef<T>>();

  add(value: T): void {
    if (this.#referencesByValue.has(value)) return;

    const reference = new WeakRef(value);
    this.#references.add(reference);
    this.#referencesByValue.set(value, reference);
  }

  clear(): void {
    this.#references.clear();
    this.#referencesByValue = new WeakMap();
  }

  delete(value: T): void {
    const reference = this.#referencesByValue.get(value);
    if (!reference) return;

    this.#references.delete(reference);
    this.#referencesByValue.delete(value);
  }

  hasValue(): boolean {
    for (const _value of this.values()) return true;
    return false;
  }

  *values(): IterableIterator<T> {
    for (const reference of this.#references) {
      const value = reference.deref();
      if (value) yield value;
      else this.#references.delete(reference);
    }
  }
}

type DOMExceptionFactory = (
  name: DOMExceptionName,
  message?: string,
) => DOMException;

const abortSignalRetentions = new WeakMap<
  WebIDLRealmHost,
  AbortSignalRetention
>();

function getAbortSignalRetention(
  realm: WebIDLRealmHost,
): AbortSignalRetention {
  let retention = abortSignalRetentions.get(realm);
  if (!retention) {
    retention = new AbortSignalRetention();
    abortSignalRetentions.set(realm, retention);
  }
  return retention;
}

const abortSignalEventTargetVirtuals: EventTargetVirtuals = {
  eventListenerListChanged(target, type) {
    if (type === 'abort') {
      AbortSignalImpl.updateRetention(target as AbortSignalImpl);
    }
  },
};
