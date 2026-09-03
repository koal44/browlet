import type { JavaScriptMethod, JavaScriptRealm } from './realm';

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
  realm: JavaScriptRealm,
  preferredType?: 'number' | 'string',
): Primitive {
  if (!isObject(value)) return value as Primitive;

  const hint = preferredType ?? 'default';
  const exotic = Reflect.get(value, Symbol.toPrimitive) as unknown;
  if (exotic !== undefined && exotic !== null) {
    if (!isCallable(exotic)) {
      return throwTypeError(realm, 'Symbol.toPrimitive is not callable');
    }
    const result = Reflect.apply(exotic, value, [hint]);
    if (isObject(result)) {
      return throwTypeError(realm, 'Symbol.toPrimitive returned an object');
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
  return throwTypeError(realm, 'Object cannot be converted to a primitive');
}

export function toNumber(value: unknown, realm: JavaScriptRealm): number {
  return toNumberFromPrimitive(toPrimitive(value, realm, 'number'), realm);
}

export function toBigInt(value: unknown, realm: JavaScriptRealm): bigint {
  const primitive = toPrimitive(value, realm, 'number');
  if (
    typeof primitive === 'bigint' ||
    typeof primitive === 'boolean' ||
    typeof primitive === 'string'
  ) return realm.intrinsics.bigInt(primitive);
  return throwTypeError(realm, 'Value cannot be converted to a bigint');
}

export function toString(value: unknown, realm: JavaScriptRealm): string {
  const primitive = toPrimitive(value, realm, 'string');
  if (typeof primitive === 'symbol') {
    return throwTypeError(realm, 'Cannot convert a Symbol value to a string');
  }
  return realm.intrinsics.string(primitive);
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

function toNumberFromPrimitive(
  value: Primitive,
  realm: JavaScriptRealm,
): number {
  if (typeof value === 'bigint' || typeof value === 'symbol') {
    return throwTypeError(realm, 'Value cannot be converted to a number');
  }
  return realm.intrinsics.number(value);
}

function throwTypeError(
  realm: JavaScriptRealm,
  message: string,
): never {
  throw new realm.intrinsics.typeError(message);
}

type Primitive = bigint | boolean | null | number | string | symbol | undefined;
