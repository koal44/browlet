import { InternalError } from '../../../infra/index';
import type { ExoticObjectHandlers } from '../../../js-engine/index';
import type { AssembledInterface, BindingContext, PlatformObjectBinding } from '../../../web-idl/index';

import type { BrowletEnvironment } from '../../environment';

import { CrossOriginObjectBinding } from './cross-origin';

/** Prepare Location's ordinary property store and its realm-selected exotic platform identity. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-location-interface
export function prepareLocationObject(owner: AssembledInterface): PlatformObjectBinding<BrowletEnvironment> | undefined {
  if (owner.primary.name !== 'Location') return;
  // SPEC_MISMATCH: create a Location object () -> Location
  return (ctx, object) => {
    Object.defineProperties(object, {
      valueOf: { value: ctx.realm.objectValueOf, writable: false, enumerable: false, configurable: false },
      [Symbol.toPrimitive]: { value: undefined, writable: false, enumerable: false, configurable: false },
    });
    // SPEC_CLASH(location-default-properties): retain browser nonconfigurable defaults; HTML reports configurable and rejects every redefinition.
    // Ordinary definition/deletion preserve browser rules, so [[DefaultProperties]] is intentionally omitted.
    // Rationale and engine dependency: ../../browsing/window/ROADMAP.md#location-descriptor-decision-review.
    const callers = new WeakMap<BindingContext<BrowletEnvironment>, ExoticObjectHandlers>();
    const platform = ctx.realm.createExoticObject((realm) => {
      // Unregistered Node calls are host access, using the object's owning binding.
      const caller = realm === undefined ? ctx : ctx.getBindingContext(realm);
      if (!caller) throw new InternalError('Location access requires a binding in its world');
      let handlers = callers.get(caller);
      if (!handlers) {
        handlers = createLocationHandlers(new CrossOriginObjectBinding(caller), platform!, object);
        callers.set(caller, handlers);
      }
      return handlers;
    });
    if (platform !== undefined) return platform;

    // TODO(stock Node): Native realm selection and changing frozen-property visibility are unavailable.
    const handler = Object.assign(Object.create(null) as ProxyHandler<object>, {
      // https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-setprototypeof
      setPrototypeOf(target: object, prototype: object | null): boolean {
        return prototype === Reflect.getPrototypeOf(target);
      },
      // https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-isextensible
      isExtensible(): boolean {
        return true;
      },
      // https://html.spec.whatwg.org/multipage/nav-history-apis.html#location-preventextensions
      preventExtensions(): boolean {
        // SPEC_CLASH(location-extensibility): follow HTML/Gecko/WebKit's always-extensible rule.
        // Chromium permits same-origin prevention and throws for foreign callers.
        return false;
      },
    });
    return new Proxy(object, handler);
  };
}

function createLocationHandlers(binding: CrossOriginObjectBinding, location: object, storage: object): ExoticObjectHandlers {
  return Object.assign(Object.create(null) as ExoticObjectHandlers, {
    getPrototypeOf: () => binding.getLocationPrototypeOf(location, Reflect.getPrototypeOf(storage)),
    setPrototypeOf: (_target: object, prototype: object | null) =>
      binding.setLocationPrototypeOf(prototype, location, Reflect.getPrototypeOf(storage)),
    isExtensible: () => true,
    // SPEC_CLASH(location-extensibility): HTML/Gecko/WebKit reject prevention for every caller; Chromium differs.
    preventExtensions: () => false,
    getOwnPropertyDescriptor: (_target: object, property: string | symbol) =>
      binding.getLocationOwnProperty(property, location, storage),
    defineProperty: (_target: object, property: string | symbol, descriptor: PropertyDescriptor) =>
      binding.defineLocationOwnProperty(property, descriptor, location, storage),
    get: (_target: object, property: string | symbol, receiver: unknown) =>
      binding.getLocation(property, receiver, location, storage),
    set: (_target: object, property: string | symbol, value: unknown, receiver: unknown) =>
      binding.setLocation(property, value, receiver, location, storage),
    deleteProperty: (_target: object, property: string | symbol) => binding.deleteLocationProperty(property, location, storage),
    ownKeys: () => binding.getLocationOwnPropertyKeys(location, storage),
    has: (_target: object, property: string | symbol) => binding.hasLocationProperty(property, location, storage),
  });
}
