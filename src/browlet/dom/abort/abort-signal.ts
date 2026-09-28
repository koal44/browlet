import { Stamper } from '../../../infra/stamper';
import type { JSEnvironment } from '../../../js-engine/index';
import {
  arg, atArg, defineInterface, idlType, op, staticOp, roAttr, reference,
  sequence, invokeWith, xattr,
  impl,
  DOMExceptionNames,
} from '../../../web-idl/index';
import {
  EventHandlerMap, eventHandlerAttr, type EventHandlerCallback,
} from '../../scripting/event-handlers';
import { timerTaskSource } from '../../scripting/timers';
import type { Realm } from '../../scripting/realm';
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
  #env: JSEnvironment;
  #eventHandlers = new EventHandlerMap(this, [{
    name: 'onabort',
    type: 'abort',
  }]);
  #reason: unknown = undefined;
  // A shared WeakRef lets every source/dependent set deduplicate by identity.
  #reference = new WeakRef(this);
  #retainedSignals: Set<AbortSignalImpl>;
  #sourceSignals = new WeakOrderedSet<AbortSignalImpl>();

  constructor(env: JSEnvironment) {
    super(abortSignalEventTargetVirtuals);
    this.#env = env;
    const global = env.exec.global;
    let retainedSignals = AbortSignalRetentionStamper.get(global);
    if (!retainedSignals) {
      retainedSignals = new Set<AbortSignalImpl>();
      AbortSignalRetentionStamper.stamp(global, retainedSignals);
    }
    this.#retainedSignals = retainedSignals;
  }

  // Binding supplies each static factory with a fresh signal in its realm.
  static abort(
    signal: AbortSignalImpl,
    reason: unknown = undefined,
  ): AbortSignalImpl {
    signal.#setAbortReason(
      reason === undefined ? new signal.#env.exec.DOMException('', DOMExceptionNames.abort) : reason,
    );
    return signal;
  }

  static timeout(
    signal: AbortSignalImpl,
    milliseconds: number,
    queueTimeoutTask: (milliseconds: number, steps: () => void) => void,
  ): AbortSignalImpl {
    queueTimeoutTask(
      milliseconds,
      () => signal.signalAbort(new signal.#env.exec.DOMException('', DOMExceptionNames.timeout)),
    );
    return signal;
  }

  static any(
    signal: AbortSignalImpl,
    signals: AbortSignalImpl[],
  ): AbortSignalImpl {
    signal.#initializeDependent(signals);
    return signal;
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
    if (this.aborted) throw this.#reason;
  }

  // -- Internal methods -------------------------------------------------

  addAlgorithm(
    algorithm: () => void,
  ): AbortAlgorithmHandle | null {
    if (this.aborted) return null;

    const handle = new AbortAlgorithmHandleImpl(this.#reference, algorithm);
    this.#abortAlgorithms.add(handle);
    this.updateRetention();
    return handle;
  }

  removeAlgorithm(handle: AbortAlgorithmHandleImpl): void {
    if (!this.#abortAlgorithms.delete(handle)) return;

    handle.detach();
    this.updateRetention();
  }

  updateRetention(): void {
    if (this.#shouldRetain()) this.#retainedSignals.add(this);
    else this.#retainedSignals.delete(this);
  }

  /** Default errors use env, or this signal's owner for internal calls. */
  signalAbort(reason: unknown = undefined, env = this.#env): void {
    if (this.aborted) return;

    // SPEC_CLASH(abort-default-reason-realm): Follow Web IDL/Chromium's method realm.
    // Gecko/WebKit use the signal realm. Binding supplies env for author calls.
    this.#setAbortReason(
      reason === undefined ? new env.exec.DOMException('', DOMExceptionNames.abort) : reason,
    );
    const dependents: AbortSignalImpl[] = [];
    for (const dependent of this.#dependentSignals.values()) {
      if (dependent.aborted) continue;

      dependent.#setAbortReason(this.#reason);
      dependents.push(dependent);
    }

    this.#runAbortSteps();
    for (const dependent of dependents) dependent.#runAbortSteps();
  }

  // -- Private ----------------------------------------------------------

  #initializeDependent(signals: AbortSignalImpl[]): void {
    for (const signal of signals) {
      if (signal.aborted) {
        this.#setAbortReason(signal.#reason);
        return;
      }
    }

    this.#dependent = true;
    for (const signal of signals) {
      if (signal.#dependent) {
        for (const source of signal.#sourceSignals.values()) {
          this.#dependOn(source);
        }
      } else {
        this.#dependOn(signal);
      }
    }
    this.updateRetention();
  }

  #dependOn(source: AbortSignalImpl): void {
    this.#sourceSignals.add(source.#reference);
    source.#dependentSignals.add(this.#reference);
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
    this.updateRetention();
  }

  #settle(): void {
    for (const source of this.#sourceSignals.values()) {
      source.#dependentSignals.delete(this.#reference);
    }
    this.#sourceSignals.clear();
    this.#dependentSignals.clear();
    this.updateRetention();
  }

  #shouldRetain(): boolean {
    return !this.aborted &&
      this.#dependent &&
      this.#sourceSignals.hasValue() &&
      (
        this.#abortAlgorithms.size > 0 ||
        this.hasEventListener('abort')
      );
  }
}

// -- Web IDL ------------------------------------------------------------

export const abortSignalIDL = defineInterface<Realm>({
  name: 'AbortSignal',
  inherits: 'EventTarget',
  exposed: '*',
  implementation: impl(AbortSignalImpl, {
    constructWith: [atArg(0, (ctx) => ctx.getEnvironment())],
  }),
  members: [
    staticOp('abort', reference('AbortSignal'),
      [arg('reason', idlType.any, { optional: true })],
      {
        ...invokeWith(atArg(0, (ctx) => ctx.construct(AbortSignalImpl))),
        ...xattr('NewObject'),
      },
    ),
    staticOp('timeout', reference('AbortSignal'),
      [arg('milliseconds', idlType.unsignedLongLong, xattr('EnforceRange'))],
      {
        ...invokeWith(
          atArg(0, (ctx) => ctx.construct(AbortSignalImpl)),
          atArg(2, (ctx) => {
            const { realm } = ctx;
            const timers = realm.env.getWindowOrWorkerGlobalScopeMixin().timers;
            return (milliseconds: number, steps: () => void) => {
              timers.runStepsAfterTimeout('AbortSignal-timeout', milliseconds, () => {
                realm.queueGlobalTask(timerTaskSource, steps);
              });
            };
          }),
        ),
        ...xattr(['Exposed', ['Window', 'Worker']], 'NewObject'),
      },
    ),
    staticOp('any', reference('AbortSignal'),
      [arg('signals', sequence(reference('AbortSignal')))],
      {
        ...invokeWith(atArg(0, (ctx) => ctx.construct(AbortSignalImpl))),
        ...xattr('NewObject'),
      },
    ),
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

  constructor(signal: WeakRef<AbortSignalImpl>, algorithm: () => void) {
    this.#algorithm = algorithm;
    this.#signal = signal;
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

class AbortSignalRetentionStamper extends Stamper {
  #signals: Set<AbortSignalImpl>;

  private constructor(global: object, signals: Set<AbortSignalImpl>) {
    super(global);
    this.#signals = signals;
  }

  static stamp<T extends object>(
    global: T,
    signals: Set<AbortSignalImpl>,
  ): T & AbortSignalRetentionStamper {
    new AbortSignalRetentionStamper(global, signals);
    return global as T & AbortSignalRetentionStamper;
  }

  static get(global: object): Set<AbortSignalImpl> | undefined {
    return #signals in global ? global.#signals : undefined;
  }
}

class WeakOrderedSet<T extends object>
{
  #references = new Set<WeakRef<T>>();

  add(reference: WeakRef<T>): void {
    this.#references.add(reference);
  }

  clear(): void {
    this.#references.clear();
  }

  delete(reference: WeakRef<T>): void {
    this.#references.delete(reference);
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

const abortSignalEventTargetVirtuals: EventTargetVirtuals = {
  eventListenerListChanged(target, type) {
    if (type === 'abort') {
      (target as AbortSignalImpl).updateRetention();
    }
  },
};
