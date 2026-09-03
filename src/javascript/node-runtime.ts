import type {
  JavaScriptRealm, JavaScriptRuntime,
} from './realm';

/*
 * One module instance represents one Node/V8 isolate. Node workers load a
 * separate module instance and therefore receive a separate runtime owner.
 */
class NodeRuntime implements JavaScriptRuntime {
  /*
   * ACCOMMODATION(node-v8-object-realms): ECMAScript does not expose [[Realm]]
   * for arbitrary objects, so retain associations for objects this host sees.
   */
  #evaluatingRealm: JavaScriptRealm | undefined;
  readonly #objectRealms = new WeakMap<object, JavaScriptRealm>();
  #tickCallback: (() => void) | undefined;

  associateRealm(value: object, realm: JavaScriptRealm): void {
    this.#objectRealms.set(value, realm);
  }

  enqueueMicrotask(steps: () => void): void {
    globalThis.queueMicrotask(steps);
  }

  getAssociatedRealm(value: object): JavaScriptRealm | undefined {
    try {
      let current: object | null = value;
      while (current !== null) {
        const associated = this.#objectRealms.get(current);
        if (associated) {
          this.#objectRealms.set(value, associated);
          return associated;
        }
        current = Reflect.getPrototypeOf(current);
      }
    } catch {
      // Proxies can prevent prototype inspection. The active evaluation is
      // the only realm information Node exposes at this boundary.
    }
    return this.#evaluatingRealm;
  }

  /*
   * ACCOMMODATION(node-v8-checkpoint): Node does not expose V8's shared
   * microtask queue through a supported synchronous API. This private hook
   * also drains next-tick and promise-rejection machinery.
   *
   * https://github.com/nodejs/node/issues/65555
   */
  readonly performMicrotaskCheckpoint = (): void => {
    this.#getTickCallback()();
  };

  runWithActiveRealm<Result>(
    realm: JavaScriptRealm,
    steps: () => Result,
  ): Result {
    const previous = this.#evaluatingRealm;
    this.#evaluatingRealm = realm;
    try {
      return steps();
    } finally {
      this.#evaluatingRealm = previous;
    }
  }

  #getTickCallback(): () => void {
    if (this.#tickCallback !== undefined) return this.#tickCallback;

    const candidate: unknown = Reflect.get(process, '_tickCallback');
    if (typeof candidate !== 'function') {
      throw new Error(
        'Node does not expose the provisional microtask checkpoint bridge',
      );
    }

    this.#tickCallback = () => { Reflect.apply(candidate, process, []); };
    return this.#tickCallback;
  }
}

export const nodeRuntime = new NodeRuntime();
