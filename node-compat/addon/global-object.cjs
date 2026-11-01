'use strict';

module.exports = setPropertyHandlers => {
  const records = new WeakMap();
  return {
    initializeGlobalObject(handle) {
      if (handle.globalObject === undefined) return;
      const object = new Proxy(handle.globalObject, ordinaryAccess);
      const record = { object, detached: false, indexed: undefined, getters: new WeakSet() };
      records.set(handle, record);
      Object.defineProperty(handle, 'globalObject', { value: object, configurable: false });
      setPropertyHandlers(handle.globalProxy, globalHandlers(record));
      const detach = handle.detachGlobal;
      Object.defineProperty(handle, 'detachGlobal', {
        value() {
          const result = Reflect.apply(detach, handle, []);
          record.detached = true;
          return result;
        },
      });
    },
    setGlobalObject(handle, object, indexedProperties) {
      const record = records.get(handle);
      if (!record || record.object !== object) throw new TypeError('Expected the context\'s allocated global object');
      record.indexed = indexedProperties;
    },
    registerGlobalGetter(handle, getter) {
      const record = records.get(handle);
      if (!record || typeof getter !== 'function') throw new TypeError('Expected a native global and its attribute getter');
      record.getters.add(getter);
    },
  };
};

// Only host reflection uses this view. Public accesses use V8's actual global;
// the native target reflects descriptors into that same original property store.
const ordinaryAccess = {
  get(target, key, receiver) {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    if (descriptor === undefined) {
      const prototype = Reflect.getPrototypeOf(target);
      return prototype === null ? undefined : Reflect.get(prototype, key, receiver);
    }
    if ('value' in descriptor) return descriptor.value;
    return descriptor.get === undefined ? undefined : Reflect.apply(descriptor.get, receiver, []);
  },
  set(target, key, value, receiver) {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    if (descriptor === undefined) {
      const prototype = Reflect.getPrototypeOf(target);
      if (prototype !== null) return Reflect.set(prototype, key, value, receiver);
    } else if (!('value' in descriptor)) {
      if (descriptor.set === undefined) return false;
      Reflect.apply(descriptor.set, receiver, [value]);
      return true;
    } else if (!descriptor.writable) return false;
    if ((typeof receiver !== 'object' || receiver === null) && typeof receiver !== 'function') return false;
    const current = Reflect.getOwnPropertyDescriptor(receiver, key);
    if (current && (!('value' in current) || !current.writable)) return false;
    return Reflect.defineProperty(receiver, key, current
      ? { value } : { value, writable: true, configurable: true, enumerable: true });
  },
};

function globalHandlers(record) {
  const indexedDescriptor = key => {
    const index = arrayIndex(key);
    return index === undefined ? undefined : record.indexed?.getOwnPropertyDescriptor(index);
  };
  const retainedAttribute = key => {
    if (!record.detached) return undefined;
    const descriptor = Reflect.getOwnPropertyDescriptor(record.object, key);
    return descriptor?.get && record.getters.has(descriptor.get) ? descriptor : undefined;
  };
  // SPEC_CLASH(retained-window-attributes): Preserve the original Window for bare
  // IDL attribute access, following binding-object ownership and WebKit. Chromium
  // redirects these receivers to the new Window; Firefox differs again.
  // A retired context's interceptor is reached only by its old global, never by
  // the public proxy once reused. Explicit/borrowed access retains V8's receiver.
  return {
    has: key => indexedDescriptor(key) !== undefined || retainedAttribute(key) !== undefined,
    get: key => retainedAttribute(key) !== undefined ? Reflect.get(record.object, key) : indexedDescriptor(key)?.value,
    // SPEC_CLASH(window-indexed-set-receiver): V8 bypasses this setter for a different receiver.
    // Absent indices then write to that receiver, as in Chromium; HTML/Firefox/WebKit reject.
    set(key, value) {
      const index = arrayIndex(key);
      if (index !== undefined && record.indexed) return record.indexed.set(index, value);
      return retainedAttribute(key) === undefined ? undefined : Reflect.set(record.object, key, value);
    },
    getOwnPropertyDescriptor: indexedDescriptor,
    defineProperty(key, descriptor) {
      const index = arrayIndex(key);
      return index === undefined ? undefined : record.indexed?.defineProperty(index, descriptor);
    },
    deleteProperty(key) {
      const index = arrayIndex(key);
      return index === undefined ? undefined : record.indexed?.deleteProperty(index);
    },
    ownKeys: () => record.indexed?.ownKeys().map(String) ?? [],
  };
}

function arrayIndex(key) {
  if (typeof key !== 'string') return undefined;
  const index = Number(key) >>> 0;
  return index !== 4294967295 && String(index) === key ? index : undefined;
}
