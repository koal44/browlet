'use strict';

module.exports = native => ({
  setPropertyDelegate: function setPropertyDelegate(object, delegate) {
    native.setPropertyDelegate(object, propertyHandlers(delegate));
  },
  setPropertyHandlers: function setPropertyHandlers(object, handlers) {
    native.setPropertyDelegate(object, nativePropertyHandlers(handlers));
  },
  setGlobalObject: function setGlobalObject(handle, object, indexedProperties) {
    if (!native.isContext(handle) || handle.globalObject !== object) {
      throw new TypeError('Expected the context\'s allocated global object');
    }
    native.setPropertyDelegate(handle.globalProxy, propertyHandlers(object, indexedProperties));
  },
});

function propertyHandlers(delegate, indexedProperties) {
  const indexedDescriptor = key => typeof key === 'string' && isIndex(key)
    ? indexedProperties?.getOwnPropertyDescriptor(Number(key)) : undefined;
  return nativePropertyHandlers({
    has: key => indexedDescriptor(key) !== undefined || Reflect.has(delegate, key),
    // Native global callbacks omit the receiver to use the per-context target.
    get: (key, receiver = delegate) => {
      const descriptor = indexedDescriptor(key);
      if (descriptor === undefined) return Reflect.get(delegate, key, receiver);
      if ('value' in descriptor) return descriptor.value;
      return descriptor.get === undefined ? undefined : Reflect.apply(descriptor.get, receiver, []);
    },
    set: (key, value, receiver = delegate) => Reflect.set(delegate, key, value, receiver),
    getOwnPropertyDescriptor: key => indexedDescriptor(key) ?? Reflect.getOwnPropertyDescriptor(delegate, key),
    defineProperty: (key, descriptor) => Reflect.defineProperty(delegate, key, descriptor),
    deleteProperty: key => Reflect.deleteProperty(delegate, key),
    ownKeys: () => indexedProperties === undefined ? Reflect.ownKeys(delegate)
      : [...new Set([...indexedProperties.ownKeys().map(String), ...Reflect.ownKeys(delegate)])],
  });
}
function nativePropertyHandlers(handlers) {
  const getPropertyAttributes = (handlers.getPropertyAttributes ?? handlers.getOwnPropertyDescriptor).bind(handlers);
  return {
    has: (key, hasOwn) => handlers.has(key, hasOwn),
    get: (key, receiver) => handlers.get(key, receiver),
    set: (key, value, receiver, hasOwn) => handlers.set(key, value, receiver, hasOwn),
    descriptor: (key, hasOwn) => handlers.getOwnPropertyDescriptor(key, hasOwn),
    query: (key, hasOwn) => {
      const descriptor = getPropertyAttributes(key, hasOwn);
      if (descriptor === undefined) return undefined;
      return (descriptor.writable === false ? 1 : 0) |
        (descriptor.enumerable ? 0 : 2) | (descriptor.configurable ? 0 : 4);
    },
    define: (key, descriptor, hasOwn) => handlers.defineProperty(key, descriptor, hasOwn),
    delete: (key, hasOwn) => handlers.deleteProperty(key, hasOwn),
    keys: () => handlers.ownKeys().filter(key => !isIndex(key)),
    indices: () => handlers.ownKeys().filter(isIndex).map(Number),
  };
}
function isIndex(key) {
  return typeof key === 'string' && String(Number(key) >>> 0) === key &&
    key !== '4294967295';
}
