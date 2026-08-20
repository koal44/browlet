/*
 * TODO(CSSOM Web IDL integration): Stylelet currently consumes this complete
 * proxy factory because its CSSStyleSheet objects are not Web IDL-bound yet.
 * The intended boundary is for Stylelet to own only a neutral backing
 * collection and its semantic mutation steps, while the host Web IDL binding
 * owns the author-facing observable-array proxy. Once CSSStyleSheet crosses
 * that boundary, move the proxy machinery into web-idl and remove this shared
 * module.
 */

export type ObservableArrayOptions<IDLValue, JavaScriptValue = IDLValue> = {
  convert: (value: unknown) => IDLValue;
  toJavaScript?: (value: IDLValue) => JavaScriptValue;
  array?: ArrayConstructor;
  rangeError?: typeof RangeError;
  toNumber?: (value: unknown) => number;
  set?: (value: IDLValue, index: number) => void;
  delete?: (value: IDLValue, index: number) => void;
};

export type ObservableArrayHandle<IDLValue, JavaScriptValue = IDLValue> = {
  readonly backingList: IDLValue[];
  readonly value: JavaScriptValue[];
  replace: (value: unknown) => void;
  replaceValues: (values: readonly IDLValue[]) => void;
};

export function createObservableArray<IDLValue, JavaScriptValue = IDLValue>({
  convert,
  toJavaScript = identity as (value: IDLValue) => JavaScriptValue,
  array: Array_ = Array,
  rangeError: RangeError_ = RangeError,
  toNumber: convertToNumber = toNumber,
  set: setAlgorithm = noop,
  delete: deleteAlgorithm = noop,
}: ObservableArrayOptions<IDLValue, JavaScriptValue>): ObservableArrayHandle<
  IDLValue,
  JavaScriptValue
> {
  const backingList: IDLValue[] = [];
  const target = Reflect.construct(Array_, []) as JavaScriptValue[];

  const setLength = (value: unknown): boolean => {
    const numberLength = convertToNumber(value);
    const uint32Length = numberLength >>> 0;
    if (uint32Length !== numberLength) {
      throw new RangeError_('Invalid array length');
    }
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

    setBackingValue(backingList, index, converted);
    return true;
  };

  const handler: ProxyHandler<JavaScriptValue[]> = {
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
        : index < backingList.length
          ? toJavaScript(backingList[index]!)
          : undefined;
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
            value: toJavaScript(backingList[index]!),
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

  const replaceValues = (values: readonly IDLValue[]): void => {
    setLength(0);
    for (let index = 0; index < values.length; index++) {
      const item = values[index]!;
      setAlgorithm(item, index);
      setBackingValue(backingList, index, item);
    }
  };

  return {
    backingList,
    value: observable,

    replace(value: unknown): void {
      const converted = convertSequence(value, convert);
      replaceValues(converted);
    },

    replaceValues,
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

function setBackingValue<T>(values: T[], index: number, value: T): void {
  Object.defineProperty(values, index, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function identity<T>(value: T): T {
  return value;
}

function noop(): void {}
