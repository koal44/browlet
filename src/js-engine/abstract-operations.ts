import type { JavaScriptMethod, JavaScriptRealm } from './realm';
import { SyntaxError, TypeError } from './simple-exception';

/** Selected ECMAScript abstract operations shared by higher specifications. */

export function isObject(value: unknown): value is object {
  return value !== null && (
    typeof value === 'object' || typeof value === 'function'
  );
}

export function isCallable(value: unknown): value is JavaScriptMethod {
  return typeof value === 'function';
}

export function isConstructor(
  value: unknown,
): value is new (...argumentsList: unknown[]) => object {
  if (!isObject(value)) return false;
  const probe = new Proxy(value, { construct: () => ({}) });
  try {
    Reflect.construct(
      probe as new (...argumentsList: unknown[]) => object,
      [],
    );
    return true;
  } catch {
    return false;
  }
}

export function isDataDescriptor(descriptor: PropertyDescriptor): boolean {
  return Object.hasOwn(descriptor, 'value') ||
    Object.hasOwn(descriptor, 'writable');
}

export function isAccessorDescriptor(descriptor: PropertyDescriptor): boolean {
  return Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set');
}

export function ordinarySetWithOwnDescriptor(
  target: object,
  property: PropertyKey,
  value: unknown,
  receiver: unknown,
  ownDescriptor: PropertyDescriptor | undefined,
): boolean {
  if (!ownDescriptor) {
    const parent = Reflect.getPrototypeOf(target);
    if (parent) return Reflect.set(parent, property, value, receiver);
    ownDescriptor = {
      configurable: true,
      enumerable: true,
      value: undefined,
      writable: true,
    };
  }

  if (isDataDescriptor(ownDescriptor)) {
    if (!ownDescriptor.writable || !isObject(receiver)) return false;
    const existing = Reflect.getOwnPropertyDescriptor(receiver, property);
    if (existing) {
      if (isAccessorDescriptor(existing) || existing.writable === false) {
        return false;
      }
      return Reflect.defineProperty(receiver, property, { value });
    }
    return Reflect.defineProperty(receiver, property, dataDescriptor(value));
  }

  if (!ownDescriptor.set) return false;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- the descriptor's receiver is supplied explicitly
  Reflect.apply(ownDescriptor.set, receiver, [value]);
  return true;
}

export function getMethod(
  value: unknown,
  key: PropertyKey,
  realm: JavaScriptRealm,
): JavaScriptMethod | undefined {
  if (value === undefined || value === null) {
    throw new realm.intrinsics.typeError(
      'Cannot get a method from null or undefined',
    );
  }
  const object: object = isObject(value)
    ? value
    : realm.intrinsics.object(value) as object;
  const method = Reflect.get(object, key, value) as unknown;
  if (method === undefined || method === null) return;
  if (!isCallable(method)) {
    throw new realm.intrinsics.typeError(`${String(key)} is not callable`);
  }
  return method;
}

export function toPrimitive(
  value: unknown,
  preferredType?: 'number' | 'string',
): Primitive {
  if (!isObject(value)) return value as Primitive;

  const hint = preferredType ?? 'default';
  const exotic = Reflect.get(value, Symbol.toPrimitive) as unknown;
  if (exotic !== undefined && exotic !== null) {
    if (!isCallable(exotic)) {
      throw new TypeError('Symbol.toPrimitive is not callable');
    }
    const result = Reflect.apply(exotic, value, [hint]);
    if (isObject(result)) {
      throw new TypeError('Symbol.toPrimitive returned an object');
    }
    return result as Primitive;
  }

  const methods = preferredType === 'string'
    ? ['toString', 'valueOf']
    : ['valueOf', 'toString'];
  for (const name of methods) {
    const method = Reflect.get(value, name) as unknown;
    if (!isCallable(method)) continue;
    const result = Reflect.apply(method, value, []);
    if (!isObject(result)) return result as Primitive;
  }
  throw new TypeError('Object cannot be converted to a primitive');
}

export function toNumber(value: unknown): number {
  const primitive = toPrimitive(value, 'number');
  if (typeof primitive === 'bigint' || typeof primitive === 'symbol') {
    throw new TypeError('Value cannot be converted to a number');
  }
  return Number(primitive);
}

export function toBigInt(value: unknown): bigint {
  const primitive = toPrimitive(value, 'number');
  if (
    typeof primitive !== 'bigint' &&
    typeof primitive !== 'boolean' &&
    typeof primitive !== 'string'
  ) throw new TypeError('Value cannot be converted to a bigint');

  // Author conversion has finished; only the primitive parser can fail here.
  try {
    return BigInt(primitive);
  } catch (error) {
    if (error instanceof globalThis.SyntaxError) {
      throw new SyntaxError(error.message);
    }
    throw error;
  }
}

export function toString(value: unknown): string {
  const primitive = toPrimitive(value, 'string');
  if (typeof primitive === 'symbol') {
    throw new TypeError('Cannot convert a Symbol value to a string');
  }
  return String(primitive);
}

export function createIteratorResultObject(
  realm: JavaScriptRealm,
  value: unknown,
  done: boolean,
): object {
  const result = realm.createOrdinaryObject(realm.intrinsics.objectPrototype);
  if (
    !Reflect.defineProperty(result, 'value', dataDescriptor(value)) ||
    !Reflect.defineProperty(result, 'done', dataDescriptor(done))
  ) {
    throw new Error('Could not initialize an iterator result object');
  }
  return result;
}

function dataDescriptor(value: unknown): PropertyDescriptor {
  return {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  };
}

type Primitive = bigint | boolean | null | number | string | symbol | undefined;
