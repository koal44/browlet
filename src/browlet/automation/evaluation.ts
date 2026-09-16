/* eslint-disable @typescript-eslint/prefer-promise-reject-errors -- Evaluation preserves arbitrary JavaScript throws and rejection reasons. */
import { Script } from 'node:vm';
import type { Realm } from '../scripting/realm';
import { createTaskSource } from '../scripting/event-loop';
import { queueGlobalTask, type QueuedTaskHandle } from '../scripting/tasks';
import { copyEvaluationValue } from './evaluation-value';

/** One page execution context and its outstanding host commands. */
export class PageEvaluation {
  readonly #realm: Realm;
  readonly #pending = new Set<(reason: Error) => void>();
  readonly #tasks = new Set<QueuedTaskHandle>();
  #disposed = false;

  constructor(realm: Realm) {
    this.#realm = realm;
  }

  evaluate(expression: string, isFunction: boolean, argument: unknown): Promise<unknown> {
    return new HostPromise((resolve, reject) => {
      if (isFunction) {
        // Method shorthand needs a function keyword when parsed as an expression.
        try { new Script(`(${expression})`); }
        catch {
          expression = expression.trim().replace(/^(async\s+)?/, '$1function ');
          try { new Script(`(${expression})`); }
          catch { throw new TypeError('The evaluation function cannot be serialized'); }
        }
      }
      const input = copyEvaluationValue(argument);
      this.#pending.add(reject);
      const complete = (value: unknown, failed = false): void => {
        if (!this.#pending.delete(reject)) return;
        try {
          const output = copyEvaluationValue(value);
          if (failed) reject(output);
          else resolve(output);
        } catch (error) {
          // A page getter can throw while its result is being copied.
          try { reject(copyEvaluationValue(error)); }
          catch { reject(new TypeError('Evaluation failure could not be copied')); }
        }
      };
      this.#enqueue(() => {
        try {
          let result = this.#realm.evaluate(
            isFunction ? `(${expression})` : expression, 'browlet-evaluate.js',
          );
          if (isFunction) {
            result = Reflect.apply(result as (...args: unknown[]) => unknown,
              undefined, [copyEvaluationValue(input, this.#realm)]);
          }
          this.#realm.promises.resolve(result).observe(
            (value) => complete(value), (error) => complete(error, true),
          );
        } catch (error) { complete(error, true); }
      });
    });
  }

  exposeFunction(name: string, callback: (args: unknown[]) => unknown): void {
    const realm = this.#realm;
    const function_ = realm.createFunction((_receiver, args) => {
      return new realm.intrinsics.promise.constructor((resolve, reject) => {
        let input: unknown[];
        try { input = copyEvaluationValue(args) as unknown[]; }
        catch (error) { reject(copyEvaluationValue(error, realm)); return; }
        // The host callback and any Promise/thenable it returns stay on Node's queue.
        void HostPromise.resolve().then(() => callback(input)).then(
          (value) => this.#deliver(value, resolve, reject, false),
          (error: unknown) => this.#deliver(error, resolve, reject, true),
        );
      });
    }, { name, length: 0 });
    Object.defineProperty(realm.globalObject, name, {
      configurable: true, enumerable: true, writable: true, value: function_,
    });
  }

  dispose(): void {
    this.#disposed = true;
    for (const task of this.#tasks) task.remove();
    this.#tasks.clear();
    for (const reject of this.#pending) {
      reject(new Error('Evaluation context was destroyed by navigation'));
    }
    this.#pending.clear();
  }

  #deliver(
    value: unknown, resolve: (value: unknown) => void,
    reject: (reason: unknown) => void, failed: boolean,
  ): void {
    if (this.#disposed) return;
    let output: unknown;
    try { output = copyEvaluationValue(value); }
    catch (error) { output = error; failed = true; }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- A result getter can navigate while it is copied.
    if (this.#disposed) return;
    this.#enqueue(() => {
      try {
        const result = copyEvaluationValue(output, this.#realm);
        if (failed) reject(result);
        else resolve(result);
      } catch (error) { reject(copyEvaluationValue(error, this.#realm)); }
    });
  }

  #enqueue(steps: () => void): void {
    if (this.#disposed) throw new Error('Evaluation context was destroyed by navigation');
    const realm = this.#realm;
    const task = queueGlobalTask(evaluationTaskSource, realm.globalObject, () => {
      this.#tasks.delete(task);
      realm.agent.eventLoop.runScriptEvaluation(realm.hostDefined!, steps);
    });
    this.#tasks.add(task);
  }
}

// Automation entry is embedder work; HTML still owns task execution and checkpoints.
const evaluationTaskSource = createTaskSource('automation');
// eslint-disable-next-line no-restricted-syntax -- Host-facing commands and callbacks belong to Node.
const HostPromise = globalThis.Promise;
