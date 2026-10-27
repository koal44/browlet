/* eslint-disable @typescript-eslint/prefer-promise-reject-errors -- Evaluation preserves arbitrary JavaScript throws and rejection reasons. */
import { Script } from 'node:vm';

import { InternalError, type TaskHandle } from '../../infra/index';
import {
  type JSRealm, copyMapData, copySetData, getDateValue, getRegExpData,
  hasDateValue, hasErrorData, hasMapData, hasRegExpMatcher, hasSetData, isCallable, isObject, isProxyObject,
} from '../../js-engine/index';
import { idlType } from '../../web-idl/core/index';

import type { WindowRealm } from '../scripting/index';
import type { Navigable } from '../browsing/navigation/index';

/** Browlet's Node-facing evaluation conveniences and their page lifetime. */
export class PageEvaluation {
  #target: Navigable;
  #evaluation: LocalEvaluation | null;
  #exposures: Map<string, (args: unknown[]) => unknown> = new Map();

  constructor(target: Navigable) {
    const window = target.activeDocument?.getRelevantGlobalObject();
    if (!window) throw new InternalError('Page evaluation requires an active Window');
    this.#target = target;
    this.#evaluation = new LocalEvaluation(window.env.realm);
    const clients = window.env.userAgent.pageEvaluations;
    let evaluations = clients.get(target);
    if (evaluations === undefined) clients.set(target, evaluations = new Set());
    evaluations.add(this);
  }

  /** Evaluate source or a serialized function, await the result, and copy it to Node. */
  evaluate<Result = unknown, Argument = unknown>(
    expression: string | ((argument: Argument) => Result), argument?: Argument,
  ): Promise<Awaited<Result>> {
    const evaluation = this.#getEvaluation();
    // TODO(WebDriver BiDi): Encode inputs and call the protocol commands after
    // retained-script execution and protocol value serialization are connected.
    // Keep this temporary path explicit; never fall back from a failed driver command.
    return (typeof expression === 'function'
      ? evaluation.callFunction(String(expression), [argument])
      : evaluation.evaluate(expression)) as Promise<Awaited<Result>>;
  }

  /** Retain a host callback and install it in the active and subsequent Windows. */
  exposeFunction(name: string, callback: (args: unknown[]) => unknown): void {
    // eslint-disable-next-line no-restricted-globals -- Node-facing convenience API.
    if (this.#exposures.has(name)) throw new Error(`Host function ${name} is already exposed`);
    this.#getEvaluation().exposeFunction(name, callback);
    this.#exposures.set(name, callback);
  }

  /** Apply Browlet's local cancellation/reinstallation policy, not a BiDi event. */
  activeDocumentChanged(): void {
    this.#evaluation?.dispose();
    const window = this.#target.activeDocument?.getRelevantGlobalObject() ?? null;
    this.#evaluation = window === null ? null : new LocalEvaluation(window.env.realm);
    if (window === null) {
      this.#exposures.clear();
      return;
    }
    for (const [name, callback] of this.#exposures) {
      this.#evaluation?.exposeFunction(name, callback);
    }
  }

  #getEvaluation(): LocalEvaluation {
    // eslint-disable-next-line no-restricted-globals -- Node-facing convenience API.
    if (this.#evaluation === null) throw new Error('Evaluation context was destroyed');
    return this.#evaluation;
  }
}

/** Temporary source evaluator; it is not an implementation of a WebDriver command. */
class LocalEvaluation {
  #realm: WindowRealm;
  /** Evaluations to reject in Node if navigation destroys this page context. */
  #pending = new Set<(reason: Error) => void>();
  /** Queued evaluation and callback-delivery tasks awaiting execution. */
  #tasks = new Set<TaskHandle>();
  #disposed = false;

  constructor(realm: WindowRealm) {
    this.#realm = realm;
  }

  /** Run page source as an HTML task and copy its eventual result back to Node. */
  evaluate(expression: string): Promise<unknown> {
    return this.#evaluate(expression, null);
  }

  /** Call a function in this page with a snapshot of the supplied arguments. */
  callFunction(functionDeclaration: string, args: unknown[]): Promise<unknown> {
    return this.#evaluate(functionDeclaration, args);
  }

  /** Install a page function that copies arguments and results between the page and Node. */
  exposeFunction(name: string, callback: (args: unknown[]) => unknown): void {
    const realm = this.#realm;
    const function_ = realm.createFunction((_receiver, args) => {
      return new realm.intrinsics.promise.constructor((resolve, reject) => {
        let input: unknown[];
        try { input = copyEvaluationValue(args) as unknown[]; }
        catch (error) { reject(copyEvaluationValue(error, realm)); return; }
        // The Node callback and any Promise/thenable it returns stay on Node's queue.
        // eslint-disable-next-line no-restricted-globals -- Run the supplied callback in Node before delivering its result to the page.
        void Promise.resolve().then(() => callback(input)).then(
          (value) => this.#deliver(value, resolve, reject, false),
          (error: unknown) => this.#deliver(error, resolve, reject, true),
        );
      });
    }, { name, length: 0 });
    Object.defineProperty(realm.globalObject, name, {
      configurable: true, enumerable: true, writable: true, value: function_,
    });
  }

  /** Cancel queued delivery and reject commands after replacement or destruction. */
  dispose(): void {
    // This cancels pending host work; it cannot interrupt executing JavaScript.
    // HTML §8.1.4.5 termination is explicitly deferred at Agent.abortRunningScript().
    this.#disposed = true;
    for (const task of this.#tasks) task.remove();
    this.#tasks.clear();
    for (const reject of this.#pending) {
      // eslint-disable-next-line no-restricted-globals -- Automation command failures belong to the Node caller, not a page realm.
      reject(new Error('Evaluation context was destroyed'));
    }
    this.#pending.clear();
  }

  #evaluate(expression: string, args: unknown[] | null): Promise<unknown> {
    // eslint-disable-next-line no-restricted-globals -- Automation calls return promises in Node.
    return new Promise((resolve, reject) => {
      if (args !== null) {
        // The local Browlet API also accepts serialized method shorthand.
        try { new Script(`(${expression})`); }
        catch {
          expression = expression.trim().replace(/^(async\s+)?/, '$1function ');
          try { new Script(`(${expression})`); }
          // eslint-disable-next-line no-restricted-globals -- Automation command failures belong to the Node caller, not a page realm.
          catch { throw new TypeError('The evaluation function cannot be serialized'); }
        }
      }
      const input = copyEvaluationValue(args) as unknown[] | null;
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
          // eslint-disable-next-line no-restricted-globals -- Automation command failures belong to the Node caller, not a page realm.
          catch { reject(new TypeError('Evaluation failure could not be copied')); }
        }
      };
      this.#enqueue(() => {
        try {
          // Retained only for Browlet's existing convenience API while the
          // WebDriver execution and protocol serialization dependencies are unfinished.
          let result = this.#realm.evaluate(
            input === null ? expression : `(${expression})`, 'browlet-evaluate.js',
          );
          if (input !== null) {
            result = Reflect.apply(result as (...args: unknown[]) => unknown,
              undefined, copyEvaluationValue(input, this.#realm) as unknown[]);
          }
          this.#realm.Promise.fromValue(result, this.#realm.intrinsics.promise.constructor, idlType.any).observe(
            (value) => complete(value), (error) => complete(error, true),
          );
        } catch (error) { complete(error, true); }
      });
    });
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
    // eslint-disable-next-line no-restricted-globals -- Automation command failures belong to the Node caller, not a page realm.
    if (this.#disposed) throw new Error('Evaluation context was destroyed');
    const realm = this.#realm;
    const task = realm.env.exec.queueTask('automation', () => {
      this.#tasks.delete(task);
      realm.agent.eventLoop.runScriptEvaluation(realm.env, steps);
    });
    this.#tasks.add(task);
  }
}

/** Copy automation data into its recipient's realm; live objects require handles. */
function copyEvaluationValue(
  value: unknown, realm?: JSRealm, memory = new Map<object, unknown>(),
): unknown {
  if (!isObject(value)) {
    // eslint-disable-next-line no-restricted-globals -- Automation copies values and reports validation errors in the Node caller's realm.
    if (typeof value === 'symbol') throw new TypeError('Symbols cannot cross the evaluation boundary');
    return value;
  }
  if (memory.has(value)) return memory.get(value);
  if (isCallable(value) || isProxyObject(value)) {
    // eslint-disable-next-line no-restricted-globals -- Automation copies values and reports validation errors in the Node caller's realm.
    throw new TypeError('Functions and proxies cannot cross the evaluation boundary; live objects require handles');
  }

  let copy: object;
  if (hasDateValue(value)) {
    const date = new (realm?.intrinsics.date ?? Date)(getDateValue(value));
    memory.set(value, date);
    return date;
  }
  if (hasRegExpMatcher(value)) {
    const { source, flags } = getRegExpData(value);
    const expression = new (realm?.intrinsics.regExp ?? RegExp)(source, flags);
    memory.set(value, expression);
    return expression;
  }
  if (hasMapData(value)) {
    const map = new (realm?.intrinsics.map ?? Map)();
    memory.set(value, map);
    for (const [key, item] of copyMapData(value)) {
      Map.prototype.set.call(map,
        copyEvaluationValue(key, realm, memory), copyEvaluationValue(item, realm, memory));
    }
    return map;
  }
  if (hasSetData(value)) {
    const set = new (realm?.intrinsics.set ?? Set)();
    memory.set(value, set);
    for (const item of copySetData(value)) {
      Set.prototype.add.call(set, copyEvaluationValue(item, realm, memory));
    }
    return set;
  }
  if (hasErrorData(value)) {
    const error = value;
    const name = String(error.name);
    const constructors: Record<string, ErrorConstructor> = realm ? {
      Error: realm.intrinsics.error, TypeError: realm.intrinsics.typeError,
      RangeError: realm.intrinsics.rangeError, SyntaxError: realm.intrinsics.syntaxError,
      ReferenceError: realm.intrinsics.referenceError, EvalError: realm.intrinsics.evalError,
      URIError: realm.intrinsics.uriError,
    // eslint-disable-next-line no-restricted-globals -- Automation copies values and reports validation errors in the Node caller's realm.
    } : { Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError };
    const constructor = Object.hasOwn(constructors, name) ? constructors[name]! : constructors.Error!;
    const result = new constructor(error.message);
    memory.set(value, result);
    result.name = name;
    const stack = error.stack;
    result.stack = stack === undefined ? undefined : String(stack);
    if (Object.hasOwn(error, 'cause')) result.cause = copyEvaluationValue(error.cause, realm, memory);
    return result;
  }
  if (Array.isArray(value)) {
    copy = new (realm?.intrinsics.array ?? Array)(value.length);
  } else {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== null && Object.getPrototypeOf(prototype) !== null) {
      // eslint-disable-next-line no-restricted-globals -- Automation copies values and reports validation errors in the Node caller's realm.
      throw new TypeError('Only data values can cross the evaluation boundary; live objects require handles');
    }
    copy = realm ? realm.createOrdinaryObject(realm.intrinsics.objectPrototype) : {};
  }
  memory.set(value, copy);
  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, {
      configurable: true, enumerable: true, writable: true,
      value: copyEvaluationValue(Reflect.get(value, key), realm, memory),
    });
  }
  return copy;
}
