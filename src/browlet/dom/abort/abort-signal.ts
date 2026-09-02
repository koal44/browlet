import {
  createDOMException, domExceptionName, type DOMExceptionName,
} from '../../../shared/dom-exception';
import { impl } from '../../../web-idl/index';
import {
  arg, defineInterface, idlType, op, roAttr, reference, resolveArgs,
  sequence, invokeWith, xattr,
} from '../../../web-idl/declaration/index';
import { queueGlobalTask } from '../../scripting/tasks';
import {
  EventHandlerMap, eventHandlerAttr, type EventHandlerCallback,
} from '../../scripting/event-handlers';
import { runStepsAfterTimeout, timerTaskSource } from '../../scripting/timers';
import {
  EventTargetImpl, type EventTargetVirtuals, fireEvent,
} from '../events/event-target';

export type AbortAlgorithmHandle = {
  remove(): void;
};

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
  #dependent = false;
  #dependentSignals = new WeakOrderedSet<AbortSignalImpl>();
  readonly #eventHandlers = new EventHandlerMap(this, [{
    name: 'onabort',
    type: 'abort',
  }]);
  readonly #global: object;
  #reason: unknown = undefined;
  readonly #retention: AbortSignalRetention;
  #sourceSignals = new WeakOrderedSet<AbortSignalImpl>();

  constructor(global: object) {
    super(abortSignalEventTargetVirtuals);
    this.#global = global;
    this.#retention = getAbortSignalRetention(global);
  }

  get aborted(): boolean {
    return this.#reason !== undefined;
  }

  get reason(): unknown {
    return this.#reason;
  }

  get onabort(): EventHandlerCallback | null {
    return this.#eventHandlers.get('onabort');
  }

  set onabort(callback: EventHandlerCallback | null) {
    this.#eventHandlers.set('onabort', callback);
  }

  throwIfAborted(): void {
    if (this.#isAborted()) throw this.#reason;
  }

  addAlgorithm(
    algorithm: () => void,
  ): AbortAlgorithmHandle | null {
    if (this.#isAborted()) return null;

    const handle = new AbortAlgorithmHandleImpl(this, algorithm);
    this.#abortAlgorithms.add(handle);
    this.#updateRetention();
    return handle;
  }

  removeAlgorithm(handle: AbortAlgorithmHandleImpl): void {
    if (!this.#abortAlgorithms.delete(handle)) return;

    handle.detach();
    this.#updateRetention();
  }

  // -- Friends ----------------------------------------------------------

  static abort(
    signal: AbortSignalImpl,
    reason: unknown = undefined,
  ): AbortSignalImpl {
    AbortSignalImpl.createAborted(signal, reason);
    return signal;
  }

  static timeout(
    signal: AbortSignalImpl,
    milliseconds: number,
  ): AbortSignalImpl {
    runStepsAfterTimeout(
      signal.#global,
      'AbortSignal-timeout',
      milliseconds,
      () => {
        queueGlobalTask(
          timerTaskSource,
          signal.#global,
          () => AbortSignalImpl.signalTimeout(signal),
        );
      },
    );
    return signal;
  }

  static any(
    signal: AbortSignalImpl,
    signals: readonly AbortSignalImpl[],
  ): AbortSignalImpl {
    return AbortSignalImpl.createDependent(signals, () => signal);
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
      signal.#createException(domExceptionName.timeout),
    );
  }

  #createAbortError(): DOMException {
    return this.#createException(domExceptionName.abort);
  }

  #createException(
    name: DOMExceptionName,
    message = '',
  ): DOMException {
    const DOMException_: unknown = Reflect.get(this.#global, 'DOMException');
    return typeof DOMException_ === 'function'
      ? Reflect.construct(DOMException_, [message, name]) as DOMException
      : createDOMException(name, message);
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
  inherits: 'EventTarget',
  exposed: '*',
  implementation: impl(AbortSignalImpl, {
    constructWith: ['current-global'],
  }),
  members: [
    op('abort', reference('AbortSignal'), [
      arg('reason', idlType.any, { optional: true }),
    ], {
      ...invokeWith(AbortSignalImpl),
      static: true,
      ...xattr('NewObject'),
    }),
    op('timeout', reference('AbortSignal'), [
      arg(
        'milliseconds',
        idlType.unsignedLongLong,
        xattr('EnforceRange'),
      ),
    ], {
      ...invokeWith(AbortSignalImpl),
      static: true,
      ...xattr(
        ['Exposed', ['Window', 'Worker']],
        'NewObject',
      ),
    }),
    op('any', reference('AbortSignal'), [
      arg(
        'signals',
        sequence(reference('AbortSignal')),
        resolveArgs(AbortSignalImpl),
      ),
    ], {
      ...invokeWith(AbortSignalImpl),
      static: true,
      ...xattr('NewObject'),
    }),
    roAttr('aborted', idlType.boolean),
    roAttr('reason', idlType.any),
    op('throwIfAborted', idlType.undefined),
    eventHandlerAttr('onabort'),
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
    if (signal) signal.removeAlgorithm(this);
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

const abortSignalRetentions = new WeakMap<object, AbortSignalRetention>();

function getAbortSignalRetention(
  global: object,
): AbortSignalRetention {
  let retention = abortSignalRetentions.get(global);
  if (!retention) {
    retention = new AbortSignalRetention();
    abortSignalRetentions.set(global, retention);
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
