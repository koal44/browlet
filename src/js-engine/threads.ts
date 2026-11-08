import { Worker, parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { availableParallelism } from 'node:os';

import { InternalError } from '../infra/internal-error';
import { internalType, type InternalPromise } from '../infra/promises';

import { NodePromise } from './node-promise';
import { addon } from './node-addons';
import type { JSTransferable } from './message-channel';

/** Independent execution using a trusted host entry, with native cloning and teardown. */
// The Node backend creates a thread and V8 isolate using the current executable,
// startup options, and environment. No browser Agent, settings, or task policy lives here.
export class JSThread<Protocol extends JSThreadProtocol> {
  /** Trusted host entry selected once during package initialization. */
  static #entryURL: string | null = null;
  /** Native children owned by this isolate, including those not yet attached. */
  static #controls = new Set<number>();

  /** Native execution owner; never exposed to higher layers. */
  #worker: Worker;
  /** Outside-owned native control; absent on stock Node and after native exit. */
  #control: number | null;
  /** Host-owned internal completion; uncaught entry failures are retained in the private exit record. */
  #closed = NodePromise.withResolvers(internalType<JSThreadExit>());
  /** Whether the host requested forced termination. */
  #stopping = false;
  /** Native exit has completed; no more input can be accepted. */
  #exited = false;
  /** Uncaught native entry failure, retained until exit. */
  #error: unknown = undefined;

  /**
   * Reload the initialized host entry in a new isolate with cloneable input data.
   * Native loading failures are retained in closed; initialize() must run first.
   */
  constructor(
    data: Protocol['startup'],
    onMessage: (message: Protocol['fromThread']) => void,
    transferList: JSTransferable[] = [],
  ) {
    const entryURL = JSThread.#entryURL;
    if (entryURL === null) throw new InternalError('Thread entry has not been initialized');
    this.#control = addon.createThreadControl?.() ?? null;
    if (this.#control !== null) {
      if (JSThread.#controls.size === 0) process.on('exit', JSThread.#stopOwnedThreads);
      JSThread.#controls.add(this.#control);
    }
    const startup: JSThreadStartup<Protocol['startup']> = { jsThreadEntry: entryURL, control: this.#control, data };
    try {
      this.#worker = new Worker(fileURLToPath(entryURL), { workerData: startup, transferList });
    } catch (error) {
      this.#releaseControl();
      throw error;
    }
    // Node's listener is untyped. This annotation trusts the shared host
    // protocol; native cloning does not validate it.
    this.#worker.on('message', (message: Protocol['fromThread']) => {
      if (!this.#stopping && !this.#exited) onMessage(message);
    });
    this.#worker.on('error', (error: unknown) => { this.#error = error; });
    this.#worker.on('exit', (code) => {
      this.#exited = true;
      this.#releaseControl();
      this.#closed.resolve({ code, error: this.#error, terminated: this.#stopping });
    });
  }

  /**
   * Select the host's file-module entry once, before constructing threads.
   * On a matching child entry, run its host setup after module evaluation finishes.
   */
  static initialize(moduleURL: string, steps: () => void): void {
    // Rollup retains the current bundle's URL; unbundled hosts name their own
    // entry rather than accidentally reloading only this engine module.
    JSThread.#entryURL = moduleURL;
    const startup = workerData as JSThreadStartup | null;
    if (parentPort !== null && startup?.jsThreadEntry === moduleURL) {
      if (startup.control !== null && !addon.attachThreadControl?.(startup.control)) {
        throw new InternalError('Thread suspension control could not be attached');
      }
      setImmediate(steps);
    }
  }

  /** Node joins children before native cleanup hooks; wake them during its earlier JavaScript exit event. */
  static #stopOwnedThreads(this: void): void {
    for (const token of JSThread.#controls) addon.stopThread!(token);
  }

  /** Whether this backend can interrupt a running script without unwinding its stack. */
  static get supportsSuspension(): boolean { return addon.createThreadControl !== undefined; }

  /** Host estimate of available logical processors; libuv returns at least one even when discovery fails. */
  static get availableParallelism(): number { return availableParallelism(); }

  /** Resolves on native exit, or rejects if termination fails; an uncaught entry failure is part of the result. */
  get closed(): InternalPromise<JSThreadExit> { return this.#closed.promise; }

  /** Whether execution has reached the native wait, rather than merely received a suspension request. */
  get suspended(): boolean { return this.#control !== null && addon.isThreadSuspended!(this.#control); }

  /** Suspend at a V8 interrupt, retaining the stack and reactions. Requires the addon; blocks the host queue too. */
  suspend(): void {
    if (this.#stopping || this.#exited) return;
    if (this.#control === null) throw new InternalError('Thread suspension requires the Node compatibility addon');
    addon.suspendThread!(this.#control);
  }

  /** Resume from outside the paused isolate, or cancel a request that has not reached its interrupt yet. */
  resume(): void {
    if (this.#stopping || this.#exited) return;
    if (this.#control === null) throw new InternalError('Thread suspension requires the Node compatibility addon');
    addon.resumeThread!(this.#control);
  }

  /** Clone internal data and move listed resources; the consumer owns readiness and task admission. */
  send(message: Protocol['toThread'], transferList: JSTransferable[] = []): void {
    if (this.#stopping || this.#exited) throw new InternalError('Execution thread is closed');
    this.#worker.postMessage(message, transferList);
  }

  /** Interrupt even blocked execution and return the same internal completion as closed. */
  terminate(): InternalPromise<JSThreadExit> {
    if (!this.#stopping && !this.#exited) {
      this.#stopping = true;
      // Node's native Promise stays at the backend boundary. Exit settles the
      // shared completion; a failed termination request rejects it instead.
      let refused = false;
      try {
        void this.#worker.terminate().catch((error: unknown) => {
          refused = true;
          this.#closed.reject(error);
        });
      } catch (error) {
        this.#closed.reject(error);
        return this.closed;
      }
      // Node accepts a stop synchronously, but a rejected backend request must
      // not be followed by raw V8 interruption without Node's shutdown state.
      // Observe an immediate refusal before waking a suspended native stack.
      if (this.#control !== null) {
        NodePromise.resolve(undefined, internalType<void>()).observe(() => {
          if (!refused && this.#control !== null) addon.stopThread!(this.#control);
        }, this.#closed.reject);
      }
    }
    return this.closed;
  }

  /** Retire the native registration after failed construction or final exit. */
  #releaseControl(): void {
    if (this.#control === null) return;
    addon.releaseThreadControl!(this.#control);
    JSThread.#controls.delete(this.#control);
    if (JSThread.#controls.size === 0) process.off('exit', JSThread.#stopOwnedThreads);
    this.#control = null;
  }
}

/** The running JSThread's initialization data and private connection to its creator. */
export class JSThreadEndpoint<Protocol extends JSThreadProtocol> {
  /** Data cloned by the native backend when this thread was created. */
  data: Protocol['startup'];
  /** Native channel hidden behind host-message operations. */
  #port: MessagePort;
  /** Native control associated during this entry's initialization, absent on stock Node. */
  #control: number | null;

  constructor() {
    if (parentPort === null) throw new InternalError('Thread endpoint requires a native worker thread');
    this.#port = parentPort;
    const startup = workerData as JSThreadStartup<Protocol['startup']>;
    this.data = startup.data;
    this.#control = startup.control;
  }

  /** Internal elapsed milliseconds excluding accepted suspension, including time before interrupt entry. */
  // This has a private time origin, independent of author-visible performance.now().
  // Stock Node cannot suspend, so its monotonic clock already counts the required time.
  get elapsedTime(): number {
    return this.#control === null ? performance.now() : addon.getThreadElapsedTime!(this.#control);
  }

  /** Rule out future suspension before inside cleanup; also cancels an interrupt not yet entered. */
  preventSuspension(): void {
    if (this.#control !== null) addon.preventThreadSuspension!(this.#control);
  }

  /** Add an internal receiver; the consumer must route browser work into its own task loop. */
  listen(onMessage: (message: Protocol['toThread']) => void): void {
    this.#port.on('message', onMessage);
  }

  /** Clone internal data and move listed resources to the creator; this is not HTML structured serialization. */
  send(message: Protocol['fromThread'], transferList: JSTransferable[] = []): void {
    this.#port.postMessage(message, transferList);
  }

  /** Release the connection; remaining native resources determine natural thread exit. */
  disconnect(): void {
    this.#port.close();
  }
}

/** Shared host contract for both ends; native cloning does not perform runtime schema validation. */
export interface JSThreadProtocol {
  /** Data supplied once when the creator starts the thread. */
  startup: unknown;
  /** Messages sent by JSThread and received by JSThreadEndpoint.listen(). */
  toThread: unknown;
  /** Messages sent by JSThreadEndpoint and delivered to JSThread's constructor callback. */
  fromThread: unknown;
}

/** Final native outcome, independent of the consumer's startup or lifetime policy. */
export interface JSThreadExit {
  code: number;
  error: unknown;
  terminated: boolean;
}

/** Native startup envelope; the host sees only its own data through the endpoint. */
interface JSThreadStartup<Data = unknown> {
  jsThreadEntry: string;
  /** Only the child receives this token; the native control remains owned by the creating isolate. */
  control: number | null;
  data: Data;
}
