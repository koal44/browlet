export type ObservableArrayOptions<T> = {
  convert: (value: unknown) => T;
  set?: (value: T, index: number) => void;
  delete?: (value: T, index: number) => void;
};

export type ObservableArrayHandle<T> = {
  readonly value: T[];
  replace: (value: unknown) => void;
};

export function createObservableArray<T>({
  convert,
  set: setAlgorithm = noop,
  delete: deleteAlgorithm = noop,
}: ObservableArrayOptions<T>): ObservableArrayHandle<T> {
  const backingList: T[] = [];
  Object.setPrototypeOf(backingList, null);
  const target: T[] = [];

  const setLength = (value: unknown): boolean => {
    const numberLength = toNumber(value);
    const uint32Length = numberLength >>> 0;
    if (uint32Length !== numberLength) throw new RangeError('Invalid array length');
    if (uint32Length > backingList.length) return false;

    for (let index = backingList.length - 1; index >= uint32Length; index--) {
      deleteAlgorithm(backingList[index]!, index);
      backingList.length = index;
    }
    return true;
  };

  const setIndex = (index: number, value: unknown): boolean => {
    const length = backingList.length;
    if (index > length) return false;

    const converted = convert(value);
    if (index < length) deleteAlgorithm(backingList[index]!, index);
    setAlgorithm(converted, index);

    if (index === length) backingList[length] = converted;
    else backingList[index] = converted;
    return true;
  };

  const handler: ProxyHandler<T[]> = {
    defineProperty(target, property, descriptor) {
      if (property === 'length') {
        if (
          isAccessorDescriptor(descriptor) ||
          descriptor.configurable === true ||
          descriptor.enumerable === true ||
          descriptor.writable === false
        ) return false;

        return 'value' in descriptor
          ? setLength(descriptor.value)
          : true;
      }

      const index = getArrayIndex(property);
      if (index !== null) {
        if (
          isAccessorDescriptor(descriptor) ||
          descriptor.configurable === false ||
          descriptor.enumerable === false ||
          descriptor.writable === false
        ) return false;

        return 'value' in descriptor
          ? setIndex(index, descriptor.value)
          : true;
      }

      return Reflect.defineProperty(target, property, descriptor);
    },

    deleteProperty(target, property) {
      if (property === 'length') return false;

      const index = getArrayIndex(property);
      if (index !== null) {
        if (index !== backingList.length - 1) return false;
        deleteAlgorithm(backingList[index]!, index);
        backingList.length = index;
        return true;
      }

      return Reflect.deleteProperty(target, property);
    },

    get(target, property, receiver) {
      if (property === 'length') return backingList.length;

      const index = getArrayIndex(property);
      return index === null
        ? Reflect.get(target, property, receiver) as unknown
        : backingList[index];
    },

    getOwnPropertyDescriptor(target, property) {
      if (property === 'length') {
        return {
          configurable: false,
          enumerable: false,
          writable: true,
          value: backingList.length,
        };
      }

      const index = getArrayIndex(property);
      if (index !== null) {
        return index < backingList.length
          ? {
            configurable: true,
            enumerable: true,
            writable: true,
            value: backingList[index],
          }
          : undefined;
      }

      return Reflect.getOwnPropertyDescriptor(target, property);
    },

    has(target, property) {
      if (property === 'length') return true;

      const index = getArrayIndex(property);
      return index === null
        ? Reflect.has(target, property)
        : index < backingList.length;
    },

    ownKeys(target) {
      const indices = Array.from(
        { length: backingList.length },
        (_, index) => String(index),
      );
      return [...indices, ...Reflect.ownKeys(target)];
    },

    preventExtensions() {
      return false;
    },

    set(target, property, value, receiver) {
      if (property === 'length') return setLength(value);

      const index = getArrayIndex(property);
      return index === null
        ? Reflect.set(target, property, value, receiver)
        : setIndex(index, value);
    },
  };
  Object.setPrototypeOf(handler, null);

  const observable = new Proxy(target, handler);

  return {
    value: observable,

    replace(value: unknown): void {
      const converted = convertSequence(value, convert);
      setLength(0);
      for (let index = 0; index < converted.length; index++) {
        const item = converted[index]!;
        setAlgorithm(item, index);
        backingList[index] = item;
      }
    },
  };
}

function convertSequence<T>(
  value: unknown,
  convert: (value: unknown) => T,
): T[] {
  if (value === null || value === undefined) {
    throw new TypeError('Value is not iterable');
  }

  const iterator = (value as { [Symbol.iterator]?: unknown; })[Symbol.iterator];
  if (typeof iterator !== 'function') {
    throw new TypeError('Value is not iterable');
  }

  return Array.from({
    [Symbol.iterator]() {
      return Reflect.apply(iterator, value, []) as Iterator<unknown>;
    },
  }, convert);
}

function getArrayIndex(property: PropertyKey): number | null {
  if (typeof property !== 'string') return null;

  const index = Number(property) >>> 0;
  return String(index) === property && index !== 0xFFFF_FFFF
    ? index
    : null;
}

function isAccessorDescriptor(descriptor: PropertyDescriptor): boolean {
  return 'get' in descriptor || 'set' in descriptor;
}

function toNumber(value: unknown): number {
  return +(value as number);
}

function noop(): void {}
