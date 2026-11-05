import { Worker, parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

import { InternalError } from '../infra/internal-error';
import { internalType, type InternalPromise } from '../infra/promises';

import { NodePromise } from './node-promise';

/** Independent execution using a trusted host entry, with native cloning and teardown. */
// The Node backend creates a thread and V8 isolate using the current executable,
// startup options, and environment. No browser Agent, settings, or task policy lives here.
export class JSThread<Protocol extends JSThreadProtocol> {
  /** Trusted host entry selected once during package initialization. */
  static #entryURL: string | null = null;

  /** Native execution owner; never exposed to higher layers. */
  #worker: Worker;
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
  constructor(data: Protocol['startup'], onMessage: (message: Protocol['fromThread']) => void) {
    const entryURL = JSThread.#entryURL;
    if (entryURL === null) throw new InternalError('Thread entry has not been initialized');
    const startup: JSThreadStartup<Protocol['startup']> = { jsThreadEntry: entryURL, data };
    this.#worker = new Worker(fileURLToPath(entryURL), { workerData: startup });
    // Node's listener is untyped. This annotation trusts the shared host
    // protocol; native cloning does not validate it.
    this.#worker.on('message', (message: Protocol['fromThread']) => {
      if (!this.#stopping && !this.#exited) onMessage(message);
    });
    this.#worker.on('error', (error: unknown) => { this.#error = error; });
    this.#worker.on('exit', (code) => {
      this.#exited = true;
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
    if (parentPort !== null && startup?.jsThreadEntry === moduleURL) setImmediate(steps);
  }

  /** Resolves on native exit, or rejects if termination fails; an uncaught entry failure is part of the result. */
  get closed(): InternalPromise<JSThreadExit> { return this.#closed.promise; }

  /** Clone internal data to the thread; the consumer owns readiness and task admission. */
  send(message: Protocol['toThread']): void {
    if (this.#stopping || this.#exited) throw new InternalError('Execution thread is closed');
    this.#worker.postMessage(message);
  }

  /** Interrupt even blocked execution and return the same internal completion as closed. */
  terminate(): InternalPromise<JSThreadExit> {
    if (!this.#stopping && !this.#exited) {
      this.#stopping = true;
      // Node's native Promise stays at the backend boundary. Exit settles the
      // shared completion; a failed termination request rejects it instead.
      void this.#worker.terminate().catch(this.#closed.reject);
    }
    return this.closed;
  }
}

/** The running JSThread's initialization data and private connection to its creator. */
export class JSThreadEndpoint<Protocol extends JSThreadProtocol> {
  /** Data cloned by the native backend when this thread was created. */
  data: Protocol['startup'];
  /** Native channel hidden behind host-message operations. */
  #port: MessagePort;

  constructor() {
    if (parentPort === null) throw new InternalError('Thread endpoint requires a native worker thread');
    this.#port = parentPort;
    this.data = (workerData as JSThreadStartup<Protocol['startup']>).data;
  }

  /** Add an internal receiver; the consumer must route browser work into its own task loop. */
  listen(onMessage: (message: Protocol['toThread']) => void): void {
    this.#port.on('message', onMessage);
  }

  /** Clone internal data to the creator; this is not HTML structured serialization. */
  send(message: Protocol['fromThread']): void {
    this.#port.postMessage(message);
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
  data: Data;
}
