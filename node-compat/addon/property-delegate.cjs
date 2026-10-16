'use strict';

module.exports = native => ({
  setPropertyDelegate: function setPropertyDelegate(object, delegate) {
    native.setPropertyDelegate(object, propertyHandlers(delegate));
  },
  setPropertyHandlers: function setPropertyHandlers(object, handlers) {
    native.setPropertyDelegate(object, nativePropertyHandlers(handlers));
  },
  setGlobalObject: function setGlobalObject(handle, object) {
    if (!native.isContext(handle) || handle.globalObject !== object) {
      throw new TypeError('Expected the context\'s allocated global object');
    }
    native.setPropertyDelegate(handle.globalProxy, propertyHandlers(object));
  },
});

function propertyHandlers(delegate) {
  return nativePropertyHandlers({
    has: key => Reflect.has(delegate, key),
    // Native global callbacks omit the receiver to use the per-context target.
    get: (key, receiver = delegate) => Reflect.get(delegate, key, receiver),
    set: (key, value, receiver = delegate) => Reflect.set(delegate, key, value, receiver),
    getOwnPropertyDescriptor: key => Reflect.getOwnPropertyDescriptor(delegate, key),
    defineProperty: (key, descriptor) => Reflect.defineProperty(delegate, key, descriptor),
    deleteProperty: key => Reflect.deleteProperty(delegate, key),
    ownKeys: () => Reflect.ownKeys(delegate),
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
