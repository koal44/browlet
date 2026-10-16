'use strict';

module.exports = native => ({
  setPropertyDelegate: function setPropertyDelegate(object, delegate) {
    native.setPropertyDelegate(object, propertyHandlers(delegate));
  },
  setGlobalObject: function setGlobalObject(handle, object) {
    if (!native.isContext(handle) || handle.globalObject !== object) {
      throw new TypeError('Expected the context\'s allocated global object');
    }
    native.setPropertyDelegate(handle.globalProxy, propertyHandlers(object));
  },
});

function propertyHandlers(delegate) {
  return {
    has: key => Reflect.has(delegate, key),
    // Native global callbacks omit the receiver to use the per-context target.
    get: (key, receiver = delegate) => Reflect.get(delegate, key, receiver),
    set: (key, value, receiver = delegate) => Reflect.set(delegate, key, value, receiver),
    descriptor: key => Reflect.getOwnPropertyDescriptor(delegate, key),
    query: key => {
      const descriptor = Reflect.getOwnPropertyDescriptor(delegate, key);
      if (descriptor === undefined) return undefined;
      return (descriptor.writable === false ? 1 : 0) |
        (descriptor.enumerable ? 0 : 2) | (descriptor.configurable ? 0 : 4);
    },
    define: (key, descriptor) => Reflect.defineProperty(delegate, key, descriptor),
    delete: key => Reflect.deleteProperty(delegate, key),
    keys: () => Reflect.ownKeys(delegate).filter(key => !isIndex(key)),
    indices: () => Reflect.ownKeys(delegate).filter(isIndex).map(Number),
  };
}
function isIndex(key) {
  return typeof key === 'string' && String(Number(key) >>> 0) === key &&
    key !== '4294967295';
}
