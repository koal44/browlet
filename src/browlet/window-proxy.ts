import { sharedPlatformObjects } from '../web-idl/platform-object';
import { WindowImpl } from './window';

/*
 * A WindowProxy is an exotic object with a [[Window]] internal slot. It has
 * no interface object of its own and is the stable global-this identity for
 * one browsing context while its wrapped Window can change on navigation.
 *
 * The forwarding below is the host-neutral shape of that object. Node cannot
 * currently install this object as a replacement VM realm's actual global
 * proxy; that execution-host limitation is documented separately.
 */
export function createWindowProxy(): WindowProxy {
  const handler = new WindowProxyHandler();
  windowProxyHandlers.set(handler.windowProxy, handler);
  return handler.windowProxy;
}

export function isWindowProxy(value: unknown): value is WindowProxy {
  return typeof value === 'object' && value !== null &&
    windowProxyHandlers.has(value as WindowProxy);
}

export function getWindowProxyWindow(
  windowProxy: WindowProxy,
): WindowImpl | null {
  return requireWindowProxyHandler(windowProxy).window;
}

export function setWindowProxyWindow(
  windowProxy: WindowProxy,
  window: WindowImpl,
): void {
  requireWindowProxyHandler(windowProxy).setWindow(window);
}

export type WindowProxy = Window & {
  readonly frames: WindowProxy;
  readonly parent: WindowProxy;
  readonly self: WindowProxy;
  readonly top: WindowProxy;
  readonly window: WindowProxy;
};

const windowProxyHandlers = new WeakMap<WindowProxy, WindowProxyHandler>();

/*
 * The handler supplies the WindowProxy exotic internal methods while the
 * Proxy it creates remains the actual WindowProxy owned by BrowsingContext.
 */
class WindowProxyHandler implements ProxyHandler<object> {
  readonly windowProxy: WindowProxy;
  readonly #methods = new Map<PropertyKey, CallableFunction>();
  #window: Window | null = null;

  constructor() {
    this.windowProxy = new Proxy({}, this) as WindowProxy;
  }

  get window(): WindowImpl | null {
    if (!this.#window) return null;
    const implementation =
      sharedPlatformObjects.getImplementationObject(this.#window) ??
      this.#window;
    if (!WindowImpl.is(implementation)) {
      throw new TypeError('WindowProxy target is not a Window implementation');
    }
    return implementation;
  }

  setWindow(window: WindowImpl): void {
    this.#window = (
      sharedPlatformObjects.getPlatformObject(window) ?? window
    ) as Window;
    this.#methods.clear();
  }

  defineProperty(
    _target: object,
    property: string | symbol,
    attributes: PropertyDescriptor,
  ): boolean {
    return Reflect.defineProperty(
      this.requireWindowObject(),
      property,
      attributes,
    );
  }

  deleteProperty(_target: object, property: string | symbol): boolean {
    return Reflect.deleteProperty(
      this.requireWindowObject(),
      property,
    );
  }

  get(_target: object, property: string | symbol): unknown {
    const window = this.requireWindowObject();
    if (
      windowProxyReferences.has(property) &&
      !Reflect.has(window, property)
    ) return this.windowProxy;

    if (eventTargetMethods.has(property)) {
      let method = this.#methods.get(property);
      if (!method) {
        method = this.createEventTargetMethod(property);
        this.#methods.set(property, method);
      }
      return method;
    }
    const value: unknown = Reflect.get(window, property, window);
    return value;
  }

  getOwnPropertyDescriptor(
    _target: object,
    property: string | symbol,
  ): PropertyDescriptor | undefined {
    const descriptor = Reflect.getOwnPropertyDescriptor(
      this.requireWindowObject(),
      property,
    );
    return descriptor && { ...descriptor, configurable: true };
  }

  getPrototypeOf(_target: object): object | null {
    return Reflect.getPrototypeOf(this.requireWindowObject());
  }

  has(_target: object, property: string | symbol): boolean {
    return windowProxyReferences.has(property) ||
      Reflect.has(this.requireWindowObject(), property);
  }

  ownKeys(_target: object): (string | symbol)[] {
    return Reflect.ownKeys(this.requireWindowObject());
  }

  set(_target: object, property: string | symbol, value: unknown): boolean {
    const window = this.requireWindowObject();
    return Reflect.set(window, property, value, window);
  }

  setPrototypeOf(_target: object, prototype: object | null): boolean {
    return Reflect.setPrototypeOf(
      this.requireWindowObject(),
      prototype,
    );
  }

  // -- Private ----------------------------------------------------------

  private requireWindowObject(): Window {
    if (!this.#window) {
      throw new Error('WindowProxy has no associated Window');
    }
    return this.#window;
  }

  private createEventTargetMethod(property: PropertyKey): CallableFunction {
    return (...argumentsList: unknown[]) => {
      const window = this.requireWindowObject();
      const method = Reflect.get(window, property) as unknown;
      if (typeof method !== 'function') {
        throw new TypeError(`${String(property)} is not callable`);
      }
      return Reflect.apply(method, window, argumentsList) as unknown;
    };
  }
}

const windowProxyReferences = new Set<PropertyKey>([
  'frames', 'parent', 'self', 'top', 'window',
]);

const eventTargetMethods = new Set<PropertyKey>([
  'addEventListener', 'dispatchEvent', 'removeEventListener',
]);

function requireWindowProxyHandler(
  windowProxy: WindowProxy,
): WindowProxyHandler {
  const handler = windowProxyHandlers.get(windowProxy);
  if (!handler) throw new TypeError('Object is not a WindowProxy');
  return handler;
}
