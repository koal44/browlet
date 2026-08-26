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

/*
 * WindowProxy is not a second Window platform object. For Web IDL receiver
 * checks, resolve its stable exotic identity to the currently wrapped Window
 * platform object. Navigation can replace that object without replacing the
 * WindowProxy.
 */
export function resolveWindowProxyReceiver(
  windowProxy: WindowProxy,
): Window | undefined {
  return requireWindowProxyHandler(windowProxy).windowObject;
}

export function setWindowProxyWindow(
  windowProxy: WindowProxy,
  window: WindowImpl,
  windowObject: Window,
): void {
  requireWindowProxyHandler(windowProxy).setWindow(window, windowObject);
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
  #window: WindowAssociation | null = null;

  constructor() {
    this.windowProxy = new Proxy({}, this) as WindowProxy;
  }

  get window(): WindowImpl | null {
    return this.#window?.implementation ?? null;
  }

  get windowObject(): Window | undefined {
    return this.#window?.object;
  }

  setWindow(window: WindowImpl, object: Window): void {
    if (!WindowImpl.is(window)) {
      throw new TypeError('WindowProxy target is not a Window implementation');
    }
    this.#window = { implementation: window, object };
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
    return this.#window.object;
  }
}

type WindowAssociation = {
  readonly implementation: WindowImpl;
  readonly object: Window;
};

const windowProxyReferences = new Set<PropertyKey>([
  'frames', 'parent', 'self', 'top', 'window',
]);

function requireWindowProxyHandler(
  windowProxy: WindowProxy,
): WindowProxyHandler {
  const handler = windowProxyHandlers.get(windowProxy);
  if (!handler) throw new TypeError('Object is not a WindowProxy');
  return handler;
}
