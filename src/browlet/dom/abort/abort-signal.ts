import type { BrowletEnvironment } from '../../scripting/environment';
import { Stamper } from '../../../infra/stamper';
import { WeakOrderedSet } from '../../../infra/collections';
import type { JSEnvironment } from '../../../js-engine/index';
import {
  arg, atArg, defineInterface, idlType, impl, invokeWith, op, reference, roAttr,
  sequence, staticOp, xattr, DOMExceptionNames,
} from '../../../web-idl/index';
import {
  EventHandlerMap, eventHandlerAttr, type EventHandlerCallback,
} from '../../scripting/event-handlers';
import { EventTargetImpl } from '../events/event-target';

/** Registration that can be removed before its abort steps run. */
export type AbortAlgorithmHandle = {
  remove(): void;
};

/** Tracks cancellation, propagates its reason, and notifies abort listeners. */
// https://dom.spec.whatwg.org/#interface-AbortSignal
export class AbortSignalImpl extends EventTargetImpl {
  #abortAlgorithms = new Set<AbortAlgorithmHandleImpl>();
  /** True once this signal is configured to follow other signals. */
  #dependent = false;
  /** Signals to abort with this signal, in registration order. */
  #dependentSignals = new WeakOrderedSet<AbortSignalImpl>();
  #env: JSEnvironment;
  #eventHandlers = new EventHandlerMap(this, [{
    name: 'onabort',
    type: 'abort',
  }]);
  /** Undefined until aborted; then shared with dependent signals. */
  // Keep writes in #setAbortReason so retention follows the aborted state.
  #reason: unknown = undefined;
  // A shared WeakRef lets every source/dependent set deduplicate by identity.
  #reference = new WeakRef(this);
  /** Pending dependents this global keeps alive for listeners or algorithms. */
  #retainedSignals: Set<AbortSignalImpl>;
  /** Nondependent signals whose abort can trigger this signal. */
  #sourceSignals = new WeakOrderedSet<AbortSignalImpl>();

  constructor(env: BrowletEnvironment) {
    super(env);
    this.#env = env;
    const global = env.exec.global;
    let retainedSignals = AbortSignalRetentionStamper.get(global);
    if (!retainedSignals) {
      retainedSignals = new Set<AbortSignalImpl>();
      AbortSignalRetentionStamper.stamp(global, retainedSignals);
    }
    this.#retainedSignals = retainedSignals;
  }

  /** Initialize a freshly allocated signal with an abort reason. */
  // Binding supplies each static factory with a fresh signal in its realm.
  // https://dom.spec.whatwg.org/#dom-abortsignal-abort
  static abort(
    signal: AbortSignalImpl,
    reason: unknown = undefined,
  ): AbortSignalImpl {
    signal.#setAbortReason(
      reason === undefined ? new signal.#env.exec.DOMException('', DOMExceptionNames.abort) : reason,
    );
    return signal;
  }

  /** Schedule a TimeoutError abort through the caller's active-time timer. */
  // https://dom.spec.whatwg.org/#dom-abortsignal-timeout
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

  /** Make a freshly allocated signal follow the first source that aborts. */
  // https://dom.spec.whatwg.org/#dom-abortsignal-any
  static any(
    signal: AbortSignalImpl,
    signals: AbortSignalImpl[],
  ): AbortSignalImpl {
    signal.#initializeDependent(signals);
    return signal;
  }

  /** Whether an abort reason has been set. */
  // https://dom.spec.whatwg.org/#dom-abortsignal-aborted
  get aborted(): boolean {
    return this.#reason !== undefined;
  }

  /** The stored abort reason, or undefined before cancellation. */
  // https://dom.spec.whatwg.org/#dom-abortsignal-reason
  get reason(): unknown {
    return this.#reason;
  }

  get onabort(): EventHandlerCallback | null {
    return this.#eventHandlers.get('onabort');
  }

  set onabort(callback: EventHandlerCallback | null) {
    this.#eventHandlers.set('onabort', callback);
  }

  /** Throw the stored reason if this signal has aborted. */
  // https://dom.spec.whatwg.org/#dom-abortsignal-throwifaborted
  throwIfAborted(): void {
    if (this.aborted) throw this.#reason;
  }

  // -- Internal methods -------------------------------------------------

  /** Register cancellation steps; returns null if already aborted. */
  // https://dom.spec.whatwg.org/#abortsignal-add
  addAlgorithm(
    algorithm: () => void,
  ): AbortAlgorithmHandle | null {
    if (this.aborted) return null;

    const handle = new AbortAlgorithmHandleImpl(this.#reference, algorithm);
    this.#abortAlgorithms.add(handle);
    this.updateRetention();
    return handle;
  }

  /** Remove pending abort steps and release their registration. */
  // https://dom.spec.whatwg.org/#abortsignal-remove
  removeAlgorithm(handle: AbortAlgorithmHandleImpl): void {
    if (!this.#abortAlgorithms.delete(handle)) return;

    handle.detach();
    this.updateRetention();
  }

  /** Update this global's strong retention of a pending dependent signal. */
  updateRetention(): void {
    if (this.#shouldRetain()) this.#retainedSignals.add(this);
    else this.#retainedSignals.delete(this);
  }

  /** Default errors use env, or this signal's owner for internal calls. */
  // https://dom.spec.whatwg.org/#abortsignal-signal-abort
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

  protected override eventListenerListChanged(type: string): void {
    if (type === 'abort') this.updateRetention();
  }

  // -- Private ----------------------------------------------------------

  // Binding has already allocated the result signal.
  // https://dom.spec.whatwg.org/#create-a-dependent-abort-signal
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

  // https://dom.spec.whatwg.org/#run-the-abort-steps
  #runAbortSteps(): void {
    for (const handle of [...this.#abortAlgorithms]) {
      if (this.#abortAlgorithms.has(handle)) handle.run();
    }
    for (const handle of this.#abortAlgorithms) handle.detach();
    this.#abortAlgorithms.clear();
    this.#settle();
    this.fireEvent('abort');
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

  // https://dom.spec.whatwg.org/#abort-signal-garbage-collection
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
export const abortSignalIDL = defineInterface<BrowletEnvironment>({
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
            const { env } = ctx.realm;
            const timers = env.getWindowOrWorkerGlobalScopeMixin().timers;
            return (milliseconds: number, steps: () => void) => {
              timers.runStepsAfterTimeout('AbortSignal-timeout', milliseconds, () => {
                env.exec.queueTask('timer', steps);
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

/** A removable abort step with a weak link to its signal. */
class AbortAlgorithmHandleImpl implements AbortAlgorithmHandle {
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

/** Stores the retained dependent signals on their owning global. */
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
